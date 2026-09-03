package authsmokecapture

import (
	"bytes"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestValidateMarkerRequiresCanonical32ByteBase64URL(t *testing.T) {
	valid := opaqueToken(1)
	if err := ValidateMarker(valid); err != nil {
		t.Fatalf("valid marker rejected: %v", err)
	}
	for _, value := range []string{
		"", strings.Repeat("a", 42), strings.Repeat("a", 44),
		strings.Repeat("+", 43), valid + "=", valid[:42] + "/",
	} {
		if err := ValidateMarker(value); err == nil {
			t.Fatalf("invalid marker accepted: %q", value)
		}
	}
}

func TestHandlerCapturesOnlyQualifyingCallbackAndPreservesResponse(t *testing.T) {
	marker := opaqueToken(2)
	session := opaqueToken(3)
	var receivedPath, receivedQuery, receivedCookie string
	upstreamServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		receivedPath = request.URL.Path
		receivedQuery = request.URL.RawQuery
		receivedCookie = request.Header.Get("Cookie")
		response.Header().Set("Location", "/__auth/account?smoke_enroll="+marker)
		response.Header().Set("X-Upstream-Proof", "preserved")
		response.Header().Set("Set-Cookie", sessionSetCookie(session))
		response.WriteHeader(http.StatusSeeOther)
		_, _ = response.Write([]byte("redirecting"))
	}))
	defer upstreamServer.Close()

	var captured string
	handler := testHandler(t, marker, upstreamServer.URL, func(token string) error {
		captured = token
		return nil
	})
	request := httptest.NewRequest(http.MethodGet, callbackPath+"?code=private-code&state=private-state", nil)
	request.Header.Set("Cookie", "__Host-tencorp_login=browser-binding")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusSeeOther {
		t.Fatalf("status = %d", response.Code)
	}
	if captured != session {
		t.Fatal("qualifying session was not captured")
	}
	if receivedPath != callbackPath || receivedQuery != "code=private-code&state=private-state" {
		t.Fatalf("upstream request = %q?%s", receivedPath, receivedQuery)
	}
	if receivedCookie != "__Host-tencorp_login=browser-binding" {
		t.Fatalf("upstream cookie = %q", receivedCookie)
	}
	if response.Header().Get("Location") != "/__auth/account?smoke_enroll="+marker ||
		response.Header().Get("Set-Cookie") != sessionSetCookie(session) ||
		response.Header().Get("X-Upstream-Proof") != "preserved" ||
		response.Body.String() != "redirecting" {
		t.Fatal("upstream response was not transparently preserved")
	}
	select {
	case <-handler.Done():
	default:
		t.Fatal("successful capture did not signal completion")
	}
}

func TestHandlerDoesNotCaptureNonqualifyingResponses(t *testing.T) {
	marker := opaqueToken(4)
	session := opaqueToken(5)
	tests := []struct {
		name          string
		status        int
		location      string
		extraLocation string
		cookies       []string
	}{
		{name: "wrong status", status: http.StatusFound, location: expectedLocation(marker), cookies: []string{sessionSetCookie(session)}},
		{name: "wrong location", status: http.StatusSeeOther, location: "/__auth/account", cookies: []string{sessionSetCookie(session)}},
		{name: "additional location query", status: http.StatusSeeOther, location: expectedLocation(marker) + "&extra=1", cookies: []string{sessionSetCookie(session)}},
		{name: "duplicate location", status: http.StatusSeeOther, location: expectedLocation(marker), extraLocation: "/unexpected", cookies: []string{sessionSetCookie(session)}},
		{name: "missing cookie", status: http.StatusSeeOther, location: expectedLocation(marker)},
		{name: "invalid value", status: http.StatusSeeOther, location: expectedLocation(marker), cookies: []string{sessionSetCookie("not-a-session")}},
		{name: "missing secure", status: http.StatusSeeOther, location: expectedLocation(marker), cookies: []string{sessionCookie + "=" + session + "; Path=/; HttpOnly; SameSite=Lax"}},
		{name: "missing httponly", status: http.StatusSeeOther, location: expectedLocation(marker), cookies: []string{sessionCookie + "=" + session + "; Path=/; Secure; SameSite=Lax"}},
		{name: "wrong path", status: http.StatusSeeOther, location: expectedLocation(marker), cookies: []string{sessionCookie + "=" + session + "; Path=/__auth; Secure; HttpOnly; SameSite=Lax"}},
		{name: "domain present", status: http.StatusSeeOther, location: expectedLocation(marker), cookies: []string{sessionCookie + "=" + session + "; Domain=form.tencorp.uz; Path=/; Secure; HttpOnly; SameSite=Lax"}},
		{name: "wrong samesite", status: http.StatusSeeOther, location: expectedLocation(marker), cookies: []string{sessionCookie + "=" + session + "; Path=/; Secure; HttpOnly; SameSite=Strict"}},
		{name: "duplicate session", status: http.StatusSeeOther, location: expectedLocation(marker), cookies: []string{sessionSetCookie(session), sessionSetCookie(opaqueToken(6))}},
		{name: "malformed duplicate session", status: http.StatusSeeOther, location: expectedLocation(marker), cookies: []string{sessionSetCookie(session), sessionCookie + "=bad value; Path=/; Secure; HttpOnly; SameSite=Lax"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			upstreamServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				response.Header().Set("Location", test.location)
				if test.extraLocation != "" {
					response.Header().Add("Location", test.extraLocation)
				}
				for _, cookie := range test.cookies {
					response.Header().Add("Set-Cookie", cookie)
				}
				response.WriteHeader(test.status)
			}))
			defer upstreamServer.Close()

			var calls atomic.Int32
			handler := testHandler(t, marker, upstreamServer.URL, func(string) error {
				calls.Add(1)
				return nil
			})
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, callbackPath+"?code=x&state=y", nil))
			if calls.Load() != 0 {
				t.Fatal("nonqualifying response was captured")
			}
			if response.Code != test.status || response.Header().Get("Location") != test.location {
				t.Fatal("nonqualifying upstream response was not preserved")
			}
			select {
			case <-handler.Done():
				t.Fatal("nonqualifying response stopped the helper")
			default:
			}
		})
	}
}

func TestHandlerAllowsOnlyExactGETCallback(t *testing.T) {
	marker := opaqueToken(7)
	var upstreamCalls atomic.Int32
	upstreamServer := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		upstreamCalls.Add(1)
	}))
	defer upstreamServer.Close()
	handler := testHandler(t, marker, upstreamServer.URL, func(string) error { return nil })

	for _, request := range []*http.Request{
		httptest.NewRequest(http.MethodPost, callbackPath, nil),
		httptest.NewRequest(http.MethodGet, callbackPath+"/extra", nil),
		httptest.NewRequest(http.MethodGet, "/", nil),
	} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusNotFound {
			t.Fatalf("%s %s status = %d", request.Method, request.URL.Path, response.Code)
		}
	}
	if upstreamCalls.Load() != 0 {
		t.Fatal("an unsupported request reached the upstream")
	}
}

func TestHandlerReadinessIsBoundToMarkerAndNeverProxied(t *testing.T) {
	marker := opaqueToken(16)
	var upstreamCalls atomic.Int32
	upstreamServer := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		upstreamCalls.Add(1)
	}))
	defer upstreamServer.Close()
	handler := testHandler(t, marker, upstreamServer.URL, func(string) error { return nil })

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, readyPrefix+marker, nil))
	if response.Code != http.StatusNoContent || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("readiness response = %d, cache=%q", response.Code, response.Header().Get("Cache-Control"))
	}
	for _, target := range []string{readyPrefix + opaqueToken(17), readyPrefix + marker + "?probe=1"} {
		response = httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, target, nil))
		if response.Code != http.StatusNotFound {
			t.Fatalf("unexpected readiness target %q returned %d", target, response.Code)
		}
	}
	if upstreamCalls.Load() != 0 {
		t.Fatal("readiness request reached the auth gateway")
	}
}

func TestHandlerReturnsGenericBadGatewayWithoutLeakingCallbackOrCookie(t *testing.T) {
	marker := opaqueToken(8)
	secret := opaqueToken(9)
	target, err := url.Parse("http://127.0.0.1:1")
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("upstream failed with " + secret)
	})}
	handler := newHandler(marker, target, client, func(string) error { return nil })
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, callbackPath+"?code="+secret, nil))

	if response.Code != http.StatusBadGateway || strings.TrimSpace(response.Body.String()) != http.StatusText(http.StatusBadGateway) {
		t.Fatalf("response = %d %q", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), secret) || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("bad gateway response leaked details or was cacheable")
	}
}

func TestHandlerDoesNotForwardCredentialWhenExclusiveWriteFails(t *testing.T) {
	marker := opaqueToken(10)
	session := opaqueToken(11)
	upstreamServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Location", expectedLocation(marker))
		response.Header().Set("Set-Cookie", sessionSetCookie(session))
		response.WriteHeader(http.StatusSeeOther)
	}))
	defer upstreamServer.Close()
	handler := testHandler(t, marker, upstreamServer.URL, func(string) error { return errors.New("output exists") })
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, callbackPath+"?code=x&state=y", nil))

	if response.Code != http.StatusBadGateway || response.Header().Get("Location") != "" || response.Header().Get("Set-Cookie") != "" {
		t.Fatal("failed persistence forwarded the new browser credential")
	}
	select {
	case <-handler.Done():
		t.Fatal("failed persistence stopped the helper")
	default:
	}
}

func TestDoneWaitsUntilResponseBodyHasBeenCopied(t *testing.T) {
	marker := opaqueToken(12)
	session := opaqueToken(13)
	releaseBody := make(chan struct{})
	headersSent := make(chan struct{})
	upstreamServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Location", expectedLocation(marker))
		response.Header().Set("Set-Cookie", sessionSetCookie(session))
		response.WriteHeader(http.StatusSeeOther)
		if flusher, ok := response.(http.Flusher); ok {
			flusher.Flush()
		}
		close(headersSent)
		<-releaseBody
		_, _ = response.Write([]byte("complete"))
	}))
	defer upstreamServer.Close()
	handler := testHandler(t, marker, upstreamServer.URL, func(string) error { return nil })
	finished := make(chan struct{})
	go func() {
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, callbackPath+"?code=x&state=y", nil))
		close(finished)
	}()
	<-headersSent
	select {
	case <-handler.Done():
		t.Fatal("helper completed before the response body was served")
	case <-time.After(20 * time.Millisecond):
	}
	close(releaseBody)
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("handler did not finish")
	}
	select {
	case <-handler.Done():
	case <-time.After(time.Second):
		t.Fatal("helper did not complete after serving the response")
	}
}

func TestWriteExclusiveCreates0600NewlineFileAndNeverOverwrites(t *testing.T) {
	path := filepath.Join(t.TempDir(), "captured")
	one := opaqueToken(14)
	two := opaqueToken(15)
	if err := writeExclusive(path, one); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %o", info.Mode().Perm())
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != one+"\n" {
		t.Fatal("captured file has unexpected contents")
	}
	if err := writeExclusive(path, two); err == nil {
		t.Fatal("exclusive writer overwrote an existing capture")
	}
	contents, err = os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != one+"\n" {
		t.Fatal("existing capture changed after a second write")
	}
}

func TestWriteExclusiveRejectsInvalidTokenWithoutCreatingFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "captured")
	if err := writeExclusive(path, "invalid"); err == nil {
		t.Fatal("invalid session token was accepted")
	}
	if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("invalid session created an output file: %v", err)
	}
}

func TestLoopbackClientDisablesAmbientProxyAndRedirects(t *testing.T) {
	client := loopbackClient()
	transport, ok := client.Transport.(*http.Transport)
	if !ok || transport.Proxy != nil {
		t.Fatal("loopback client can use an ambient proxy")
	}
	if err := client.CheckRedirect(&http.Request{}, nil); !errors.Is(err, http.ErrUseLastResponse) {
		t.Fatal("loopback client follows redirects")
	}
}

func testHandler(t *testing.T, marker, rawTarget string, sink func(string) error) *Handler {
	t.Helper()
	target, err := url.Parse(rawTarget)
	if err != nil {
		t.Fatal(err)
	}
	client := upstreamHTTPClient(upstreamServerTransport(rawTarget))
	return newHandler(marker, target, client, sink)
}

func upstreamServerTransport(_ string) http.RoundTripper {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DisableCompression = true
	return transport
}

func upstreamHTTPClient(transport http.RoundTripper) *http.Client {
	return &http.Client{
		Transport:     transport,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

func expectedLocation(marker string) string {
	return "/__auth/account?smoke_enroll=" + marker
}

func sessionSetCookie(session string) string {
	return sessionCookie + "=" + session + "; Path=/; Secure; HttpOnly; SameSite=Lax"
}

func opaqueToken(fill byte) string {
	return base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{fill}, 32))
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}
