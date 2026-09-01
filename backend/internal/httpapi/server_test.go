package httpapi

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/tencorp/real-estate-platform/backend/internal/domain"
)

func TestRouterConstructionAndServiceInfo(t *testing.T) {
	handler := New(nil, slog.New(slog.NewTextHandler(io.Discard, nil)), "http://localhost:3000")
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Header.Set("Origin", "http://localhost:3000")

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status %d", recorder.Code)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:3000" {
		t.Fatalf("unexpected CORS origin %q", got)
	}
}

func TestCORSRequiresExactOriginAndRejectsDisallowedLeadOrigin(t *testing.T) {
	handler := New(nil, slog.New(slog.NewTextHandler(io.Discard, nil)), "https://example.com, https://www.example.com")

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	handler.ServeHTTP(recorder, request)
	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("request without Origin received CORS origin %q", got)
	}

	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodOptions, "/v1/leads", nil)
	request.Header.Set("Origin", "https://evil.example")
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("disallowed preflight returned %d", recorder.Code)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("disallowed preflight received CORS origin %q", got)
	}

	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/v1/leads", strings.NewReader(`{}`))
	request.Header.Set("Origin", "https://evil.example")
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("disallowed lead POST returned %d", recorder.Code)
	}
	if got := recorder.Header().Get("Cache-Control"); !strings.Contains(got, "no-store") {
		t.Fatalf("lead rejection Cache-Control = %q", got)
	}
}

func TestAllowedOriginsFailClosed(t *testing.T) {
	origins := parseAllowedOrigins("*, null, https://example.com/path, https://example.com")
	if len(origins) != 1 {
		t.Fatalf("accepted origins = %#v", origins)
	}
	if _, ok := origins["https://example.com"]; !ok {
		t.Fatalf("valid origin missing from %#v", origins)
	}
}

func TestHealthIsProcessLiveness(t *testing.T) {
	handler := New(nil, slog.New(slog.NewTextHandler(io.Discard, nil)), "")
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)

	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("liveness without a store returned %d", recorder.Code)
	}
}

func TestOptionsMatchesNestedPaths(t *testing.T) {
	handler := New(nil, slog.New(slog.NewTextHandler(io.Discard, nil)), "http://localhost:3000")
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodOptions, "/v1/projects/ofiyat/units", nil)

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("unexpected status %d", recorder.Code)
	}
}

func TestValidateLeadRequest(t *testing.T) {
	consent := true
	valid := createLeadRequest{ProjectSlug: "mirador", Name: "Aziz", Phone: "+998901234567", Goal: "live", Language: "ru", Consent: &consent}
	if message := validateLeadRequest(valid); message != "" {
		t.Fatalf("valid request rejected: %s", message)
	}
	invalid := valid
	invalid.Phone = "901234567"
	if message := validateLeadRequest(invalid); message == "" {
		t.Fatal("invalid phone was accepted")
	}
}

func TestValidateLeadRequestRequiresConsent(t *testing.T) {
	consent := false
	request := createLeadRequest{ProjectSlug: "mirador", Name: "Aziz", Phone: "+998901234567", Goal: "live", Language: "ru", Consent: &consent}
	if message := validateLeadRequest(request); message != "consent must be true" {
		t.Fatalf("unexpected validation message %q", message)
	}
	request.Consent = nil
	if message := validateLeadRequest(request); message != "consent must be true" {
		t.Fatalf("missing consent accepted: %q", message)
	}
}

func TestValidateLeadRequestBoundsUntrustedMetadata(t *testing.T) {
	consent := true
	request := createLeadRequest{ProjectSlug: "mirador", Name: "Aziz", Phone: "+998901234567", Goal: "live", Language: "ru", Consent: &consent}
	request.UTMContent = strings.Repeat("x", 1025)
	if message := validateLeadRequest(request); !strings.Contains(message, "tracking values") {
		t.Fatalf("oversized tracking value returned %q", message)
	}
	request.UTMContent = "safe\nunsafe"
	if message := validateLeadRequest(request); !strings.Contains(message, "tracking values") {
		t.Fatalf("control character returned %q", message)
	}
}

func TestParseUnitReferencesKeepsIdentityNamespaces(t *testing.T) {
	tests := []struct {
		name      string
		unitID    string
		unitKey   string
		want      []domain.UnitReference
		wantError bool
	}{
		{
			name:   "legacy source id",
			unitID: `"aaa4e56c-4fb7-4ad4-91e9-f0d8972f836d"`,
			want:   []domain.UnitReference{{Namespace: domain.UnitReferenceSourceID, Value: "aaa4e56c-4fb7-4ad4-91e9-f0d8972f836d"}},
		},
		{
			name:   "numeric database id",
			unitID: `12`,
			want:   []domain.UnitReference{{Namespace: domain.UnitReferenceInternalID, Value: "12"}},
		},
		{
			name:   "numeric string is legacy source id",
			unitID: `"12"`,
			want:   []domain.UnitReference{{Namespace: domain.UnitReferenceSourceID, Value: "12"}},
		},
		{
			name:    "numeric-looking unit key stays source key",
			unitKey: `"50"`,
			want:    []domain.UnitReference{{Namespace: domain.UnitReferenceSourceKey, Value: "50"}},
		},
		{name: "null", unitID: `null`},
		{name: "fractional numeric id", unitID: `12.5`, wantError: true},
		{name: "numeric unit key", unitKey: `12`, wantError: true},
		{name: "empty string", unitID: `""`, wantError: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := parseUnitReferences([]byte(test.unitID), []byte(test.unitKey))
			if test.wantError {
				if err == nil {
					t.Fatalf("parseUnitReferences(%s,%s) unexpectedly succeeded", test.unitID, test.unitKey)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseUnitReferences(%s,%s): %v", test.unitID, test.unitKey, err)
			}
			if len(got) != len(test.want) {
				t.Fatalf("references=%#v, want %#v", got, test.want)
			}
			for index := range got {
				if got[index] != test.want[index] {
					t.Fatalf("reference[%d]=%#v, want %#v", index, got[index], test.want[index])
				}
			}
		})
	}
}

func TestRegnumStringUnitIDsRemainSourceIDs(t *testing.T) {
	// These are the numeric-looking string IDs in the versioned Regnum Plaza
	// snapshot. They are external source_id values, not deployment-local unit
	// table IDs.
	for _, value := range []int{12, 235, 250, 736, 880, 1273, 1441, 1635, 2032, 2234, 2285, 2713} {
		raw := []byte(fmt.Sprintf(`"%d"`, value))
		references, err := parseUnitReferences(raw, nil)
		if err != nil {
			t.Fatalf("Regnum string unitId %d: %v", value, err)
		}
		if len(references) != 1 || references[0].Namespace != domain.UnitReferenceSourceID || references[0].Value != strconv.Itoa(value) {
			t.Fatalf("Regnum string unitId %d parsed as %#v", value, references)
		}

		lastViewedRaw := []byte(fmt.Sprintf(`{"uuid":"%d","unitId":"%d"}`, value, value))
		lastViewed, err := parseLastViewedReferences(lastViewedRaw)
		if err != nil {
			t.Fatalf("Regnum lastViewedApartment string id %d: %v", value, err)
		}
		if len(lastViewed) != 1 || lastViewed[0].Namespace != domain.UnitReferenceSourceID || lastViewed[0].Value != strconv.Itoa(value) {
			t.Fatalf("Regnum lastViewedApartment string id %d parsed as %#v", value, lastViewed)
		}
	}
}

func TestUnitIdentityFieldsAreComparedAfterNamespacedResolution(t *testing.T) {
	references, err := parseUnitReferences([]byte(`"crm-unit-45"`), []byte(`"mirador-stable-45"`))
	if err != nil || len(references) != 2 {
		t.Fatalf("distinct namespace references = (%#v,%v)", references, err)
	}
	if references[0].Namespace != domain.UnitReferenceSourceID || references[1].Namespace != domain.UnitReferenceSourceKey {
		t.Fatalf("references lost namespace: %#v", references)
	}

	lastViewed, err := parseLastViewedReferences([]byte(`{"unitKey":"mirador-stable-45","uuid":"crm-unit-45","area":83.9,"price":1}`))
	if err != nil || len(lastViewed) != 2 {
		t.Fatalf("last viewed references = (%#v,%v)", lastViewed, err)
	}
	if _, err := parseLastViewedReferences([]byte(`{"uuid":"one","unitId":"two"}`)); err == nil {
		t.Fatal("conflicting last-viewed source_id fields were accepted")
	}
}

func TestCreateLeadRejectsNonJSONAndTrailingData(t *testing.T) {
	handler := New(nil, slog.New(slog.NewTextHandler(io.Discard, nil)), "", false)
	valid := `{"projectSlug":"mirador","name":"Aziz","phone":"+998901234567","goal":"live","language":"ru","consent":true}`

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/leads", bytes.NewBufferString(valid))
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("missing JSON content type returned %d", recorder.Code)
	}

	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/v1/leads", bytes.NewBufferString(valid+` {}`))
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("trailing JSON returned %d", recorder.Code)
	}
}

func TestCreateLeadRejectsOversizedBody(t *testing.T) {
	handler := New(nil, slog.New(slog.NewTextHandler(io.Discard, nil)), "", false)
	body := `{"ignored":"` + strings.Repeat("x", 64<<10) + `"}`
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/leads", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")

	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized body returned %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestCreateLeadSupportsContextAliasWithoutWritingInDev(t *testing.T) {
	handler := New(nil, slog.New(slog.NewTextHandler(io.Discard, nil)), "", false)
	body := `{"projectSlug":"sun","name":"Aziz","phone":"+998901234567","goal":"live","language":"ru","consent":true,"context":"catalog:card","unitKey":"sun-a-a2-f2","lastViewedApartment":{"unitKey":"sun-a-a2-f2","area":83.9}}`
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/leads", bytes.NewBufferString(body))
	request.Header.Set("Content-Type", "application/json; charset=utf-8")
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("disabled lead writer returned %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestLeadSlotShedsExcessConcurrency(t *testing.T) {
	server := &Server{leadSlots: make(chan struct{}, 1)}
	if !server.acquireLeadSlot() {
		t.Fatal("first lead slot was rejected")
	}
	if server.acquireLeadSlot() {
		t.Fatal("excess lead slot was accepted")
	}
	server.releaseLeadSlot()
	if !server.acquireLeadSlot() {
		t.Fatal("released lead slot could not be reacquired")
	}
}

func TestRetryAfterRoundsUp(t *testing.T) {
	if got := retryAfterSeconds(time.Second + time.Nanosecond); got != "2" {
		t.Fatalf("retry after = %q", got)
	}
	if got := retryAfterSeconds(0); got != "1" {
		t.Fatalf("disabled retry after = %q", got)
	}
}

func TestLeadInternalErrorDoesNotLogRawError(t *testing.T) {
	var output bytes.Buffer
	server := &Server{logger: slog.New(slog.NewTextHandler(&output, nil))}
	recorder := httptest.NewRecorder()
	rawPII := "failing row contains (Backend QA,+998000000000)"

	server.leadInternalError(recorder, errors.New(rawPII))
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("lead error returned %d", recorder.Code)
	}
	if strings.Contains(output.String(), rawPII) || strings.Contains(output.String(), "+998") {
		t.Fatalf("raw lead error leaked to log: %s", output.String())
	}
}
