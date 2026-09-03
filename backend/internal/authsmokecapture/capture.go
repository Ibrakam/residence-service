// Package authsmokecapture implements the one-shot, loopback-only proxy used
// to enroll a real Telegram session in the protected deployment smoke checks.
package authsmokecapture

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	ListenAddress = "127.0.0.1:4341"
	callbackPath  = "/__auth/telegram/callback"
	readyPrefix   = "/__auth-smoke/ready/"
	upstream      = "http://127.0.0.1:4340"
	outputDir     = "/run/tencorp-auth-gateway"
	OutputPath    = outputDir + "/deploy-smoke-session.captured"
	sessionCookie = "__Host-tencorp_session"
)

var errInvalidMarker = errors.New("marker must be a canonical 32-byte base64url value")

// Handler proxies the single OIDC callback path and closes Done after it has
// safely persisted and returned one qualifying session response.
type Handler struct {
	marker string
	target *url.URL
	client *http.Client
	sink   func(string) error

	done     chan struct{}
	doneOnce sync.Once
}

// New creates the production handler. Its upstream and output destination are
// deliberately compile-time constants rather than operator-controlled input.
func New(marker string) (*Handler, error) {
	if err := ValidateMarker(marker); err != nil {
		return nil, err
	}
	if err := prepareOutputDestination(); err != nil {
		return nil, err
	}
	target, err := url.Parse(upstream)
	if err != nil {
		return nil, errors.New("invalid fixed auth gateway target")
	}
	return newHandler(marker, target, loopbackClient(), func(token string) error {
		return writeExclusive(OutputPath, token)
	}), nil
}

// ValidateMarker accepts only the canonical unpadded base64url encoding of 32
// random bytes. The marker is an enrollment nonce, not a session credential.
func ValidateMarker(marker string) error {
	if !validOpaqueToken(marker) {
		return errInvalidMarker
	}
	return nil
}

func newHandler(marker string, target *url.URL, client *http.Client, sink func(string) error) *Handler {
	return &Handler{
		marker: marker,
		target: target,
		client: client,
		sink:   sink,
		done:   make(chan struct{}),
	}
}

// Done closes only after a qualifying upstream response has been persisted and
// copied to the browser. Callers can then gracefully shut down the HTTP server.
func (handler *Handler) Done() <-chan struct{} { return handler.done }

func (handler *Handler) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	if request.Method == http.MethodGet && request.URL.RawQuery == "" && request.URL.Path == readyPrefix+handler.marker {
		response.Header().Set("Cache-Control", "no-store")
		response.WriteHeader(http.StatusNoContent)
		return
	}
	if request.Method != http.MethodGet || request.URL.Path != callbackPath {
		http.NotFound(response, request)
		return
	}

	upstreamRequest := request.Clone(request.Context())
	upstreamRequest.URL = &url.URL{
		Scheme:   handler.target.Scheme,
		Host:     handler.target.Host,
		Path:     callbackPath,
		RawQuery: request.URL.RawQuery,
	}
	upstreamRequest.RequestURI = ""
	upstreamRequest.Body = nil
	upstreamRequest.GetBody = nil
	upstreamRequest.ContentLength = 0
	upstreamRequest.Header = request.Header.Clone()
	removeHopByHop(upstreamRequest.Header)

	upstreamResponse, err := handler.client.Do(upstreamRequest)
	if err != nil {
		badGateway(response)
		return
	}
	defer upstreamResponse.Body.Close()

	qualifying, token := handler.qualifyingResponse(upstreamResponse)
	if qualifying {
		if err := handler.sink(token); err != nil {
			badGateway(response)
			return
		}
	}

	copyHeaders(response.Header(), upstreamResponse.Header)
	response.WriteHeader(upstreamResponse.StatusCode)
	_, copyErr := io.Copy(response, upstreamResponse.Body)
	if qualifying && copyErr == nil {
		handler.doneOnce.Do(func() { close(handler.done) })
	}
}

func (handler *Handler) qualifyingResponse(response *http.Response) (bool, string) {
	locations := response.Header.Values("Location")
	if response.StatusCode != http.StatusSeeOther || len(locations) != 1 ||
		locations[0] != "/__auth/account?smoke_enroll="+handler.marker {
		return false, ""
	}

	var match *http.Cookie
	for _, rawCookie := range response.Header.Values("Set-Cookie") {
		cookie, err := http.ParseSetCookie(rawCookie)
		if err != nil {
			if strings.HasPrefix(strings.TrimSpace(rawCookie), sessionCookie+"=") {
				return false, ""
			}
			continue
		}
		if cookie.Name != sessionCookie {
			continue
		}
		if match != nil {
			return false, ""
		}
		match = cookie
	}
	if match == nil || !validOpaqueToken(match.Value) || !match.Secure || !match.HttpOnly ||
		match.Path != "/" || match.Domain != "" || match.SameSite != http.SameSiteLaxMode {
		return false, ""
	}
	return true, match.Value
}

func validOpaqueToken(value string) bool {
	if len(value) != 43 || strings.Contains(value, "=") {
		return false
	}
	raw, err := base64.RawURLEncoding.DecodeString(value)
	return err == nil && len(raw) == 32 && base64.RawURLEncoding.EncodeToString(raw) == value
}

func loopbackClient() *http.Client {
	transport := &http.Transport{
		Proxy:                 nil,
		DialContext:           (&net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		DisableCompression:    true,
		DisableKeepAlives:     true,
		ResponseHeaderTimeout: 30 * time.Second,
	}
	return &http.Client{
		Transport: transport,
		Timeout:   35 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

func prepareOutputDestination() error {
	info, err := os.Lstat(outputDir)
	if errors.Is(err, os.ErrNotExist) {
		if err := os.Mkdir(outputDir, 0o700); err != nil {
			return errors.New("create capture runtime directory")
		}
		info, err = os.Lstat(outputDir)
	}
	if err != nil {
		return errors.New("inspect capture runtime directory")
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0o077 != 0 {
		return errors.New("capture runtime directory is unsafe")
	}
	if _, err := os.Lstat(OutputPath); err == nil {
		return errors.New("capture output already exists")
	} else if !errors.Is(err, os.ErrNotExist) {
		return errors.New("inspect capture output")
	}
	return nil
}

func writeExclusive(path, token string) (returnErr error) {
	if !validOpaqueToken(token) {
		return errors.New("refuse to persist invalid session token")
	}
	file, err := os.OpenFile(filepath.Clean(path), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return errors.New("create capture output")
	}
	closed := false
	defer func() {
		if !closed {
			if closeErr := file.Close(); returnErr == nil && closeErr != nil {
				returnErr = errors.New("close capture output")
			}
		}
		if returnErr != nil {
			_ = os.Remove(path)
		}
	}()
	if err := file.Chmod(0o600); err != nil {
		return errors.New("secure capture output")
	}
	if _, err := io.WriteString(file, token+"\n"); err != nil {
		return errors.New("write capture output")
	}
	if err := file.Sync(); err != nil {
		return errors.New("sync capture output")
	}
	if err := file.Close(); err != nil {
		closed = true
		return errors.New("close capture output")
	}
	closed = true
	return nil
}

func badGateway(response http.ResponseWriter) {
	response.Header().Set("Cache-Control", "no-store")
	http.Error(response, http.StatusText(http.StatusBadGateway), http.StatusBadGateway)
}

func copyHeaders(destination, source http.Header) {
	cloned := source.Clone()
	removeHopByHop(cloned)
	for key, values := range cloned {
		for _, value := range values {
			destination.Add(key, value)
		}
	}
}

func removeHopByHop(header http.Header) {
	for _, connection := range header.Values("Connection") {
		for name := range strings.SplitSeq(connection, ",") {
			header.Del(strings.TrimSpace(name))
		}
	}
	for _, name := range []string{
		"Connection", "Proxy-Connection", "Keep-Alive", "Proxy-Authenticate",
		"Proxy-Authorization", "Te", "Trailer", "Transfer-Encoding", "Upgrade",
	} {
		header.Del(name)
	}
}

// Shutdown gracefully stops server after either a successful capture or a
// caller-controlled cancellation.
func Shutdown(server *http.Server) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		_ = server.Close()
		return errors.New("shut down capture server")
	}
	return nil
}
