package ui

import (
	"html"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

func TestRenderLoginContract(t *testing.T) {
	recorder := httptest.NewRecorder()
	err := RenderLogin(recorder, Model{
		Language:       "ru",
		AcceptLanguage: "en-US,en;q=0.9",
		ReturnTo:       "/workspace/reports?lang=ru&view=2",
	})
	if err != nil {
		t.Fatalf("RenderLogin() error = %v", err)
	}
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}

	body := recorder.Body.String()
	assertContains(t, body, `<html lang="ru" dir="ltr">`)
	assertContains(t, body, `Войти через Telegram`)
	assertContains(t, body, `method="post" action="/__auth/telegram/start"`)
	assertContains(t, body, `name="return_to" value="/workspace/reports?lang=ru&amp;view=2"`)
	assertContains(t, body, `name="lang" value="ru"`)
	assertContains(t, body, `href="/privacy?lang=ru"`)
	assertContains(t, body, `prefers-reduced-motion: reduce`)
	assertContains(t, body, `min-height: 44px`)
	assertContains(t, body, `Подтверждённый номер телефона`)
	assertContains(t, body, `Telegram OIDC · серверная сессия`)
	assertContains(t, body, `class="session-note__shield" aria-hidden="true">✓</span>`)
	assertContains(t, body, `class="session-note__copy"`)
	assertContains(t, body, `class="brand-stage__wordmark"`)
	assertContains(t, body, `viewBox="0 0 230.34 59.17"`)
	assertContains(t, body, `url("/__auth/assets/brand-city-v1.webp")`)

	if strings.Contains(strings.ToLower(body), "<script") {
		t.Fatal("authorization UI must not contain inline or external scripts")
	}
	if regexp.MustCompile(`(?i)(?:src|href)=["']https?://`).MatchString(body) {
		t.Fatal("authorization UI must not load external resources")
	}
	for _, forbiddenClaim := range []string{"+998", "меньше минуты", "TLS · 256"} {
		if strings.Contains(body, forbiddenClaim) {
			t.Fatalf("authorization UI contains unsupported or locale-specific claim %q", forbiddenClaim)
		}
	}

	assertSecurityHeaders(t, recorder)
}

func TestRenderLoginEscapesModelAndRejectsUnsafeReturnTargets(t *testing.T) {
	unsafeTargets := []string{
		"https://evil.example/steal",
		"//evil.example/steal",
		"/%2f%2fevil.example/steal",
		"/%255c%255cevil.example/steal",
		"/safe\r\nLocation: https://evil.example",
	}
	for _, target := range unsafeTargets {
		t.Run(target, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			if err := RenderLogin(recorder, Model{Language: "en", ReturnTo: target}); err != nil {
				t.Fatalf("RenderLogin() error = %v", err)
			}
			body := html.UnescapeString(recorder.Body.String())
			assertContains(t, body, `name="return_to" value="/"`)
			if strings.Contains(body, "evil.example") {
				t.Fatalf("unsafe return target reflected in body: %q", target)
			}
		})
	}

	xss := `/search?q="><script>alert(1)</script>&next=ok`
	recorder := httptest.NewRecorder()
	if err := RenderLogin(recorder, Model{Language: "en", ReturnTo: xss}); err != nil {
		t.Fatalf("RenderLogin() error = %v", err)
	}
	body := recorder.Body.String()
	if strings.Contains(body, `<script>alert(1)</script>`) || strings.Contains(body, `value="/search?q="><script>`) {
		t.Fatal("return target was not HTML-escaped")
	}
	assertContains(t, body, `&lt;script&gt;alert(1)&lt;/script&gt;`)
}

func TestLanguageSelection(t *testing.T) {
	tests := []struct {
		name            string
		model           Model
		wantLanguage    string
		wantText        string
		contentLanguage string
	}{
		{name: "explicit Uzbek wins", model: Model{Language: "uz", AcceptLanguage: "en"}, wantLanguage: "uz", wantText: "Telegram orqali kiring", contentLanguage: "uz"},
		{name: "English regional accept", model: Model{AcceptLanguage: "en-GB,en;q=0.8,ru;q=0.5"}, wantLanguage: "en", wantText: "Sign in with Telegram", contentLanguage: "en"},
		{name: "quality preference", model: Model{Language: "de", AcceptLanguage: "ru;q=0.4, uz-Latn-UZ;q=0.9"}, wantLanguage: "uz", wantText: "Telegram orqali kiring", contentLanguage: "uz"},
		{name: "default Russian", model: Model{AcceptLanguage: "de,fr;q=0.8"}, wantLanguage: "ru", wantText: "Войти через Telegram", contentLanguage: "ru"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			if err := RenderLogin(recorder, test.model); err != nil {
				t.Fatalf("RenderLogin() error = %v", err)
			}
			assertContains(t, recorder.Body.String(), `<html lang="`+test.wantLanguage+`"`)
			assertContains(t, recorder.Body.String(), test.wantText)
			if got := recorder.Header().Get("Content-Language"); got != test.contentLanguage {
				t.Fatalf("Content-Language = %q, want %q", got, test.contentLanguage)
			}
		})
	}
}

func TestRenderErrorIsLocalizedAndDoesNotReflectErrorCode(t *testing.T) {
	recorder := httptest.NewRecorder()
	err := RenderError(recorder, Model{
		Language:   "en",
		ReturnTo:   "/avalon/",
		ErrorCode:  `phone_required<script>alert(1)</script>`,
		StatusCode: http.StatusUnauthorized,
	})
	if err != nil {
		t.Fatalf("RenderError() error = %v", err)
	}
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", recorder.Code)
	}
	body := recorder.Body.String()
	assertContains(t, body, `We could not complete sign-in`)
	assertContains(t, body, `role="alert"`)
	assertContains(t, body, `method="post" action="/__auth/telegram/start"`)
	if strings.Contains(body, "phone_required") || strings.Contains(body, "alert(1)") {
		t.Fatal("raw error code must not be reflected")
	}
	assertSecurityHeaders(t, recorder)

	phoneRecorder := httptest.NewRecorder()
	if err := RenderError(phoneRecorder, Model{Language: "uz", ErrorCode: "phone_required", StatusCode: 422}); err != nil {
		t.Fatalf("RenderError(phone) error = %v", err)
	}
	assertContains(t, phoneRecorder.Body.String(), `Raqam tasdiqlanmadi`)

	blockedRecorder := httptest.NewRecorder()
	if err := RenderError(blockedRecorder, Model{Language: "ru", ErrorCode: "account_blocked", StatusCode: http.StatusForbidden}); err != nil {
		t.Fatalf("RenderError(blocked) error = %v", err)
	}
	assertContains(t, blockedRecorder.Body.String(), `Аккаунт заблокирован`)
}

func TestRenderLoginShowsOnlyKnownSafeNotice(t *testing.T) {
	recorder := httptest.NewRecorder()
	if err := RenderLogin(recorder, Model{Language: "en", ErrorCode: "session_expired"}); err != nil {
		t.Fatalf("RenderLogin() error = %v", err)
	}
	assertContains(t, recorder.Body.String(), `role="status"`)
	assertContains(t, recorder.Body.String(), `Your session has ended.`)

	unknownRecorder := httptest.NewRecorder()
	if err := RenderLogin(unknownRecorder, Model{Language: "en", ErrorCode: `<img src=x onerror=alert(1)>`}); err != nil {
		t.Fatalf("RenderLogin(unknown) error = %v", err)
	}
	if strings.Contains(unknownRecorder.Body.String(), "onerror") || strings.Contains(unknownRecorder.Body.String(), `role="status"`) {
		t.Fatal("unknown login error code must not be reflected")
	}
}

func TestRenderErrorConstrainsStatusAndAccessibilityLandmarks(t *testing.T) {
	recorder := httptest.NewRecorder()
	if err := RenderError(recorder, Model{Language: "ru", StatusCode: http.StatusOK}); err != nil {
		t.Fatalf("RenderError() error = %v", err)
	}
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", recorder.Code)
	}
	body := recorder.Body.String()
	for _, required := range []string{
		`class="skip-link" href="#auth-panel"`,
		`<nav class="language-switch" aria-label=`,
		`<main class="auth-main" id="auth-panel" tabindex="-1">`,
		`<h1 id="card-title">`,
		`<button class="telegram-button" type="submit">`,
		`<footer class="footer">`,
	} {
		assertContains(t, body, required)
	}
}

func TestAuthorizationCopyIsNeutralAcrossLanguages(t *testing.T) {
	for _, language := range []string{"ru", "uz", "en"} {
		t.Run(language, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			if err := RenderLogin(recorder, Model{Language: language, ReturnTo: "/"}); err != nil {
				t.Fatal(err)
			}
			body := recorder.Body.String()
			for _, forbidden := range []string{
				"Residence Service", "жилыми комплексами", "ЖК", "TJM",
				"SAN’AT", "Avalon", "Mirador", "residential project", "every project",
			} {
				if strings.Contains(body, forbidden) {
					t.Fatalf("neutral authorization UI contains %q", forbidden)
				}
			}
		})
	}
}

func TestSafeReturnToPreservesValidRelativeURLs(t *testing.T) {
	valid := []string{
		"/",
		"/mirador",
		"/sanat/flats?lang=uz",
		"/жк?query=hello%20world",
		"/path?next=https%3A%2F%2Fexample.com",
	}
	for _, value := range valid {
		if got := safeReturnTo(value); got != value {
			t.Errorf("safeReturnTo(%q) = %q, want unchanged", value, got)
		}
	}
}

func assertSecurityHeaders(t *testing.T, recorder *httptest.ResponseRecorder) {
	t.Helper()
	headers := recorder.Header()
	for name, want := range map[string]string{
		"Content-Type":           "text/html; charset=utf-8",
		"Cache-Control":          "no-store, max-age=0",
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":        "DENY",
		"Referrer-Policy":        "same-origin",
	} {
		if got := headers.Get(name); got != want {
			t.Errorf("%s = %q, want %q", name, got, want)
		}
	}
	csp := headers.Get("Content-Security-Policy")
	for _, directive := range []string{"default-src 'none'", "style-src 'sha256-", "img-src 'self'", "font-src 'self'", "form-action 'self' https://oauth.telegram.org", "frame-ancestors 'none'"} {
		if !strings.Contains(csp, directive) {
			t.Errorf("CSP %q does not contain %q", csp, directive)
		}
	}
	if strings.Contains(csp, "'unsafe-inline'") || strings.Contains(csp, "'unsafe-eval'") || strings.Contains(csp, "form-action https:") {
		t.Errorf("CSP contains an unsafe source: %q", csp)
	}
}

func assertContains(t *testing.T, value, fragment string) {
	t.Helper()
	if !strings.Contains(value, fragment) {
		t.Fatalf("output does not contain %q", fragment)
	}
}
