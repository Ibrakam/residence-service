package httpapi

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func constructionPassportHandler(t *testing.T, upstream http.Handler) http.Handler {
	t.Helper()
	server := httptest.NewServer(upstream)
	t.Cleanup(server.Close)
	return NewWithOptions(nil, slog.New(slog.NewTextHandler(io.Discard, nil)), Options{
		MarketMapURL:     server.URL,
		MarketMapTimeout: time.Second,
	})
}

func resetConstructionPassportCache(t *testing.T) {
	t.Helper()
	constructionPassportCache.mu.Lock()
	constructionPassportCache.entries = make(map[string]constructionPassportCacheEntry)
	constructionPassportCache.flights = make(map[string]*constructionPassportFlight)
	constructionPassportCache.mu.Unlock()
	t.Cleanup(func() {
		constructionPassportCache.mu.Lock()
		constructionPassportCache.entries = make(map[string]constructionPassportCacheEntry)
		constructionPassportCache.flights = make(map[string]*constructionPassportFlight)
		constructionPassportCache.mu.Unlock()
	})
}

func passportResponse(projectKey string, objectID int) map[string]any {
	return map[string]any{
		"project": map[string]any{"key": projectKey},
		"objects": []map[string]any{{
			"object_id": objectID,
			"documents": map[string]any{
				"official_dshk_passport": fmt.Sprintf("https://api-nazorat.mc.uz/object-info/%d", objectID),
			},
		}},
		"object_count": 1,
	}
}

func TestConstructionPassportProxyReturnsOnlyValidatedOfficialLinks(t *testing.T) {
	handler := constructionPassportHandler(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/project-passports/soy-boyi" {
			t.Fatalf("upstream path = %q", r.URL.Path)
		}
		if r.Header.Get("Accept") != "application/json" {
			t.Fatalf("upstream Accept = %q", r.Header.Get("Accept"))
		}
		if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
			t.Fatalf("caller credentials leaked upstream: Authorization=%q Cookie=%q", r.Header.Get("Authorization"), r.Header.Get("Cookie"))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"project": map[string]any{"key": "soy-boyi", "name": "Soy Bo‘yi", "private": "not forwarded"},
			"objects": []map[string]any{
				{
					"object_id": 10, "project_linked_at": "2026-09-15T10:00:00+00:00",
					"documents": map[string]any{"official_dshk_passport": "https://api-nazorat.mc.uz/object-info/111", "registration_extract": "private"},
				},
				{
					"object_id": 11, "project_linked_at": "2026-09-16T10:00:00+00:00",
					"name": "Soy Bo‘yi — II очередь", "address": "Ташкент",
					"documents": map[string]any{"official_dshk_passport": "https://api-nazorat.mc.uz/object-info/222"},
				},
				{
					"object_id": 12, "project_linked_at": "2026-09-14T10:00:00+00:00",
					"documents": map[string]any{"official_dshk_passport": "https://api-nazorat.mc.uz/object-info/222"},
				},
			},
			"object_count": 3,
		})
	}))

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/v1/construction-passports/soy-boyi", nil)
	request.Header.Set("Authorization", "Bearer caller-secret")
	request.Header.Set("Cookie", "session=caller-secret")
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if recorder.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("Cache-Control=%q", recorder.Header().Get("Cache-Control"))
	}
	var payload constructionPassportsPayload
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.ProjectKey != "soy-boyi" || !payload.Linked || payload.ObjectCount != 3 || len(payload.Passports) != 2 {
		t.Fatalf("unexpected payload: %#v", payload)
	}
	if payload.Passports[0].URL != "https://api-nazorat.mc.uz/object-info/222" || payload.Passports[0].LinkedAt != "2026-09-16T10:00:00+00:00" {
		t.Fatalf("official passport selection = %#v", payload)
	}
	if payload.Passports[0].Name != "Soy Bo‘yi — II очередь" || payload.Passports[0].Address != "Ташкент" {
		t.Fatalf("public passport labels = %#v", payload.Passports[0])
	}
	for _, forbidden := range []string{"private", "registration_extract", "object_id"} {
		if value := recorder.Body.String(); strings.Contains(value, forbidden) {
			t.Fatalf("response leaked %q: %s", forbidden, value)
		}
	}
}

func TestConstructionPassportProxyReportsUnlinkedProjectWithoutInventingURL(t *testing.T) {
	handler := constructionPassportHandler(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"project":{"key":"soy-boyi"},"objects":[],"object_count":0}`)
	}))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/construction-passports/soy-boyi", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var payload constructionPassportsPayload
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Linked || len(payload.Passports) != 0 || payload.ObjectCount != 0 {
		t.Fatalf("unlinked payload = %#v", payload)
	}
}

func TestConstructionPassportProxyCachesSuccessfulResponse(t *testing.T) {
	resetConstructionPassportCache(t)
	var calls atomic.Int32
	handler := constructionPassportHandler(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		_ = json.NewEncoder(w).Encode(passportResponse("soy-boyi", 111))
	}))

	for range 2 {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/construction-passports/soy-boyi", nil))
		if recorder.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
		}
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("upstream calls=%d, want 1", got)
	}
}

func TestConstructionPassportProxyCoalescesConcurrentMisses(t *testing.T) {
	resetConstructionPassportCache(t)
	const requestCount = 12
	var calls atomic.Int32
	upstreamEntered := make(chan struct{}, 1)
	releaseUpstream := make(chan struct{})
	handler := constructionPassportHandler(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		select {
		case upstreamEntered <- struct{}{}:
		default:
		}
		<-releaseUpstream
		_ = json.NewEncoder(w).Encode(passportResponse("soy-boyi", 222))
	}))

	start := make(chan struct{})
	var ready sync.WaitGroup
	var complete sync.WaitGroup
	ready.Add(requestCount)
	complete.Add(requestCount)
	errors := make(chan string, requestCount)
	for range requestCount {
		go func() {
			defer complete.Done()
			ready.Done()
			<-start
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/construction-passports/soy-boyi", nil))
			if recorder.Code != http.StatusOK {
				errors <- fmt.Sprintf("status=%d body=%s", recorder.Code, recorder.Body.String())
			}
		}()
	}
	ready.Wait()
	close(start)
	<-upstreamEntered
	time.Sleep(25 * time.Millisecond)
	close(releaseUpstream)
	complete.Wait()
	close(errors)
	for message := range errors {
		t.Error(message)
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("upstream calls=%d, want 1", got)
	}
}

func TestConstructionPassportProxyServesBoundedStaleResponseOnUpstreamFailure(t *testing.T) {
	resetConstructionPassportCache(t)
	var calls atomic.Int32
	var fail atomic.Bool
	handler := constructionPassportHandler(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		if fail.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_ = json.NewEncoder(w).Encode(passportResponse("soy-boyi", 333))
	}))

	first := httptest.NewRecorder()
	handler.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/v1/construction-passports/soy-boyi", nil))
	if first.Code != http.StatusOK {
		t.Fatalf("priming status=%d body=%s", first.Code, first.Body.String())
	}

	constructionPassportCache.mu.Lock()
	for key, entry := range constructionPassportCache.entries {
		entry.fetchedAt = time.Now().Add(-constructionPassportFreshTTL - time.Second)
		constructionPassportCache.entries[key] = entry
	}
	constructionPassportCache.mu.Unlock()
	fail.Store(true)

	stale := httptest.NewRecorder()
	handler.ServeHTTP(stale, httptest.NewRequest(http.MethodGet, "/v1/construction-passports/soy-boyi", nil))
	if stale.Code != http.StatusOK || stale.Header().Get("Warning") != `110 - "Response is stale"` {
		t.Fatalf("stale status=%d warning=%q body=%s", stale.Code, stale.Header().Get("Warning"), stale.Body.String())
	}
	var payload constructionPassportsPayload
	if err := json.Unmarshal(stale.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Passports) != 1 || payload.Passports[0].ObjectID != 333 {
		t.Fatalf("stale payload=%#v", payload)
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("upstream calls=%d, want 2", got)
	}
	retrySuppressed := httptest.NewRecorder()
	handler.ServeHTTP(retrySuppressed, httptest.NewRequest(http.MethodGet, "/v1/construction-passports/soy-boyi", nil))
	if retrySuppressed.Code != http.StatusOK || retrySuppressed.Header().Get("Warning") != `110 - "Response is stale"` {
		t.Fatalf("retry-suppressed status=%d warning=%q body=%s", retrySuppressed.Code, retrySuppressed.Header().Get("Warning"), retrySuppressed.Body.String())
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("upstream calls during retry cooldown=%d, want 2", got)
	}

	constructionPassportCache.mu.Lock()
	for key, entry := range constructionPassportCache.entries {
		entry.fetchedAt = time.Now().Add(-constructionPassportStaleTTL - time.Second)
		constructionPassportCache.entries[key] = entry
	}
	constructionPassportCache.mu.Unlock()
	expired := httptest.NewRecorder()
	handler.ServeHTTP(expired, httptest.NewRequest(http.MethodGet, "/v1/construction-passports/soy-boyi", nil))
	if expired.Code != http.StatusBadGateway {
		t.Fatalf("expired stale status=%d body=%s", expired.Code, expired.Body.String())
	}
}

func TestConstructionPassportProxyRejectsUnknownProjectBeforeUpstream(t *testing.T) {
	var calls atomic.Int32
	handler := constructionPassportHandler(t, http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		calls.Add(1)
	}))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/construction-passports/not-published", nil))
	if recorder.Code != http.StatusNotFound || calls.Load() != 0 {
		t.Fatalf("status=%d upstream_calls=%d", recorder.Code, calls.Load())
	}
}

func TestConstructionPassportProxyFailsClosedForUnsafeOfficialURL(t *testing.T) {
	handler := constructionPassportHandler(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"project":{"key":"soy-boyi"},"objects":[{"object_id":1,"project_linked_at":"2026-09-16T10:00:00+00:00","documents":{"official_dshk_passport":"https://api-nazorat.mc.uz.evil.example/object-info/222"}}],"object_count":1}`)
	}))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/construction-passports/soy-boyi", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var payload constructionPassportsPayload
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if !payload.Linked || len(payload.Passports) != 0 {
		t.Fatalf("unsafe upstream URL escaped validation: %#v", payload)
	}
}

func TestConstructionPassportProxyDoesNotFollowRedirects(t *testing.T) {
	handler := constructionPassportHandler(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Location", "https://example.com/secret")
		w.WriteHeader(http.StatusFound)
	}))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/construction-passports/soy-boyi", nil))
	if recorder.Code != http.StatusBadGateway {
		t.Fatalf("redirect status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestConstructionPassportProxyTreatsUpstreamNotFoundAsContractFailure(t *testing.T) {
	handler := constructionPassportHandler(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotFound, "missing", "missing")
	}))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/construction-passports/soy-boyi", nil))
	if recorder.Code != http.StatusBadGateway {
		t.Fatalf("upstream 404 status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestConstructionPassportProxyBrieflyCachesUpstreamFailure(t *testing.T) {
	resetConstructionPassportCache(t)
	var calls atomic.Int32
	handler := constructionPassportHandler(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	for range 2 {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/construction-passports/soy-boyi", nil))
		if recorder.Code != http.StatusBadGateway {
			t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
		}
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("upstream calls=%d during failure cooldown, want 1", got)
	}
}

func TestConstructionPassportLimitIsAppliedAfterValidationAndDeduplication(t *testing.T) {
	for _, test := range []struct {
		name       string
		uniqueURLs bool
		wantStatus int
		wantLinks  int
	}{
		{name: "duplicates collapse", uniqueURLs: false, wantStatus: http.StatusOK, wantLinks: 1},
		{name: "too many unique passports fail closed", uniqueURLs: true, wantStatus: http.StatusBadGateway},
	} {
		t.Run(test.name, func(t *testing.T) {
			objects := make([]map[string]any, maxConstructionPassports+1)
			for index := range objects {
				passportID := 1
				if test.uniqueURLs {
					passportID = index + 1
				}
				objects[index] = map[string]any{
					"object_id": index + 1,
					"documents": map[string]any{"official_dshk_passport": fmt.Sprintf("https://api-nazorat.mc.uz/object-info/%d", passportID)},
				}
			}
			handler := constructionPassportHandler(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				_ = json.NewEncoder(w).Encode(map[string]any{
					"project":      map[string]any{"key": "soy-boyi"},
					"objects":      objects,
					"object_count": len(objects),
				})
			}))
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/construction-passports/soy-boyi", nil))
			if recorder.Code != test.wantStatus {
				t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
			}
			if test.wantStatus == http.StatusOK {
				var payload constructionPassportsPayload
				if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
					t.Fatal(err)
				}
				if len(payload.Passports) != test.wantLinks {
					t.Fatalf("passport links=%d, want %d", len(payload.Passports), test.wantLinks)
				}
			}
		})
	}
}

func TestOfficialPassportURLValidation(t *testing.T) {
	valid := "https://api-nazorat.mc.uz/object-info/240228796"
	if got := officialPassportURL(valid); got != valid {
		t.Fatalf("official URL = %q", got)
	}
	for _, unsafe := range []string{
		"http://api-nazorat.mc.uz/object-info/240228796",
		"https://user@api-nazorat.mc.uz/object-info/240228796",
		"https://api-nazorat.mc.uz:443/object-info/240228796",
		"https://api-nazorat.mc.uz.evil.example/object-info/240228796",
		"https://api-nazorat.mc.uz/object-info/0",
		"https://api-nazorat.mc.uz/object-info/%32%34",
		"https://api-nazorat.mc.uz/object-info/240228796?download=1",
		"https://api-nazorat.mc.uz/object-info/240228796#details",
	} {
		if got := officialPassportURL(unsafe); got != "" {
			t.Errorf("unsafe URL escaped validation: %q => %q", unsafe, got)
		}
	}
}

func TestMarketMapURLIsRestrictedToLoopback(t *testing.T) {
	for _, valid := range []string{"http://127.0.0.1:8765", "http://localhost:8765/internal", "https://[::1]:8765"} {
		if parseMarketMapURL(valid) == nil {
			t.Errorf("loopback URL rejected: %q", valid)
		}
	}
	for _, unsafe := range []string{"https://example.com", "http://127.0.0.1:8765/?token=secret", "http://user@127.0.0.1:8765"} {
		if parseMarketMapURL(unsafe) != nil {
			t.Errorf("non-loopback or credential-bearing URL accepted: %q", unsafe)
		}
	}
}
