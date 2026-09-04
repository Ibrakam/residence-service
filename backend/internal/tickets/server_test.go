package tickets

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type fakeRunnerStore struct {
	claim           ClaimResult
	health          Health
	enqueuedID      int64
	progressCalled  bool
	leaseOwnerCalls int
	completeCalls   int
	enqueuedProject string
}

func (f *fakeRunnerStore) Health(context.Context) (Health, error) { return f.health, nil }
func (f *fakeRunnerStore) Claim(_ context.Context, workerID, token string, _ time.Duration) (ClaimResult, error) {
	f.claim.WorkerID = workerID
	f.claim.LeaseToken = token
	return f.claim, nil
}
func (f *fakeRunnerStore) LeaseOwner(context.Context, int64, string) (string, error) {
	f.leaseOwnerCalls++
	return "ticket-runner", nil
}
func (f *fakeRunnerStore) Heartbeat(context.Context, string, string, time.Duration) (time.Time, error) {
	return time.Date(2026, 9, 2, 12, 5, 0, 0, time.UTC), nil
}
func (f *fakeRunnerStore) UpdateProgress(context.Context, int64, string, string, string) error {
	f.progressCalled = true
	return nil
}

func (f *fakeRunnerStore) Complete(context.Context, int64, string, Completion) error {
	f.completeCalls++
	return nil
}
func (f *fakeRunnerStore) Fail(context.Context, int64, string, string) error { return nil }
func (f *fakeRunnerStore) AttachmentForWorker(context.Context, int64, int64, string, string) (Attachment, error) {
	return Attachment{}, ErrAttachmentAbsent
}
func (f *fakeRunnerStore) EnqueueTest(_ context.Context, _ int64, _, projectKey string) (int64, error) {
	f.enqueuedProject = projectKey
	return f.enqueuedID, nil
}

func newTestWorkerServer(t *testing.T, store *fakeRunnerStore) (*WorkerServer, Config) {
	t.Helper()
	cfg := validConfig()
	server, err := NewWorkerServer(cfg, store)
	if err != nil {
		t.Fatal(err)
	}
	return server, cfg
}

func TestCompletionAcknowledgementDoesNotRequireAnActiveLeaseLookup(t *testing.T) {
	store := &fakeRunnerStore{}
	server, cfg := newTestWorkerServer(t, store)
	for range 2 {
		request := httptest.NewRequest(http.MethodPost, "/internal/ticket-runner/tickets/7/complete",
			strings.NewReader(`{"summary":"deployed","commitSha":"abc"}`))
		request.Header.Set("Authorization", "Bearer "+cfg.WorkerAPIToken)
		request.Header.Set("X-Ticket-Lease", "same-finalization-token")
		recorder := httptest.NewRecorder()
		server.Handler().ServeHTTP(recorder, request)
		if recorder.Code != http.StatusOK {
			t.Fatalf("completion acknowledgement = %d %s", recorder.Code, recorder.Body.String())
		}
	}
	if store.completeCalls != 2 || store.leaseOwnerCalls != 0 {
		t.Fatalf("complete calls=%d lease lookups=%d", store.completeCalls, store.leaseOwnerCalls)
	}
}

func TestWorkerAPIHealthVersionAndAuthentication(t *testing.T) {
	store := &fakeRunnerStore{health: Health{Queued: 2, Ready: 1}}
	server, cfg := newTestWorkerServer(t, store)

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), RunnerAPIVersion) {
		t.Fatalf("liveness = %d %s", recorder.Code, recorder.Body.String())
	}

	recorder = httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/internal/ticket-runner/health", nil))
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("unprotected health returned %d", recorder.Code)
	}

	request := httptest.NewRequest(http.MethodGet, "/internal/ticket-runner/health", nil)
	request.Header.Set("Authorization", "Bearer "+cfg.WorkerAPIToken)
	recorder = httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"queued":2`) {
		t.Fatalf("protected health = %d %s", recorder.Code, recorder.Body.String())
	}
}

func TestLeaseShapeUsesConfiguredPublicBaseInsteadOfHostHeader(t *testing.T) {
	size := int64(42)
	store := &fakeRunnerStore{claim: ClaimResult{
		ExpiresAt: time.Date(2026, 9, 2, 12, 5, 0, 0, time.UTC),
		Ticket: &Ticket{ID: 7, Source: "telegram", ProjectKey: ProjectMarketMap, Body: "Fix reset", AttemptCount: 1, Attachments: []Attachment{{
			ID: 9, TicketID: 7, MIMEType: "image/png", FileName: "screen.png", ByteSize: &size, SHA256: strings.Repeat("a", 64),
		}}},
	}}
	server, cfg := newTestWorkerServer(t, store)
	request := httptest.NewRequest(http.MethodPost, "/internal/ticket-runner/lease", strings.NewReader(`{}`))
	request.Host = "attacker.example"
	request.Header.Set("Authorization", "Bearer "+cfg.WorkerAPIToken)
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("lease = %d %s", recorder.Code, recorder.Body.String())
	}
	body := recorder.Body.String()
	expectedURL := "https://example.test/__residence-ticket-worker/internal/ticket-runner/tickets/7/attachments/9"
	if !strings.Contains(body, expectedURL) || strings.Contains(body, "attacker.example") {
		t.Fatalf("lease attachment URL = %s", body)
	}
	for _, field := range []string{`"leaseToken"`, `"leaseExpiresAt"`, `"attempt":1`, `"title":"Fix reset"`, `"projectKey":"market-map"`} {
		if !strings.Contains(body, field) {
			t.Fatalf("lease missing %s: %s", field, body)
		}
	}
}

func TestTestTicketProjectIsAllowlistedAndDefaultsToResidence(t *testing.T) {
	store := &fakeRunnerStore{enqueuedID: 19}
	server, cfg := newTestWorkerServer(t, store)

	for _, test := range []struct {
		body       string
		wantStatus int
		wantKey    string
	}{
		{body: `{"text":"default"}`, wantStatus: http.StatusCreated, wantKey: ProjectResidence},
		{body: `{"text":"map","projectKey":"market-map"}`, wantStatus: http.StatusCreated, wantKey: ProjectMarketMap},
		{body: `{"text":"bad","projectKey":"other"}`, wantStatus: http.StatusBadRequest},
	} {
		store.enqueuedProject = ""
		request := httptest.NewRequest(http.MethodPost, "/internal/ticket-runner/test-tickets", strings.NewReader(test.body))
		request.Header.Set("Authorization", "Bearer "+cfg.WorkerAPIToken)
		recorder := httptest.NewRecorder()
		server.Handler().ServeHTTP(recorder, request)
		if recorder.Code != test.wantStatus || store.enqueuedProject != test.wantKey {
			t.Fatalf("body=%s status=%d project=%q response=%s", test.body, recorder.Code, store.enqueuedProject, recorder.Body.String())
		}
	}
}

func TestProgressRequiresTicketLeaseHeader(t *testing.T) {
	store := &fakeRunnerStore{}
	server, cfg := newTestWorkerServer(t, store)
	request := httptest.NewRequest(http.MethodPost, "/internal/ticket-runner/tickets/7/progress", strings.NewReader(`{"summary":"testing"}`))
	request.Header.Set("Authorization", "Bearer "+cfg.WorkerAPIToken)
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnauthorized || store.progressCalled {
		t.Fatalf("progress without lease = %d called=%v", recorder.Code, store.progressCalled)
	}

	request = httptest.NewRequest(http.MethodPost, "/internal/ticket-runner/tickets/7/progress", strings.NewReader(`{"summary":"testing"}`))
	request.Header.Set("Authorization", "Bearer "+cfg.WorkerAPIToken)
	request.Header.Set("X-Ticket-Lease", "lease-token")
	recorder = httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || !store.progressCalled {
		t.Fatalf("progress with lease = %d called=%v body=%s", recorder.Code, store.progressCalled, recorder.Body.String())
	}
}
