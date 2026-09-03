package ui

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRenderAccountContractIsPrivacyMinimal(t *testing.T) {
	recorder := httptest.NewRecorder()
	err := RenderAccount(recorder, AccountModel{
		Language: "ru", Name: `Иван <script>alert(1)</script>`, Username: "@operator",
		TelegramID: 99887766, SessionExpiresAt: time.Date(2026, 9, 4, 15, 30, 0, 0, time.FixedZone("UZT", 5*60*60)),
	})
	if err != nil {
		t.Fatalf("RenderAccount() error = %v", err)
	}
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	body := recorder.Body.String()
	for _, required := range []string{
		`<html lang="ru" dir="ltr">`, `method="post" action="/__auth/logout"`,
		`method="post" action="/__auth/logout-all"`, `href="/privacy?lang=ru"`, `href="/"`,
		`99887766`, `@operator`, `datetime="2026-09-04T10:30:00Z"`, `min-height: 44px`,
		`prefers-reduced-motion: reduce`,
		`class="brand-stage__wordmark"`, `viewBox="0 0 230.34 59.17"`,
	} {
		assertContains(t, body, required)
	}
	if strings.Contains(body, `<script>alert(1)</script>`) || !strings.Contains(body, `&lt;script&gt;alert(1)&lt;/script&gt;`) {
		t.Fatal("account name was not safely escaped")
	}
	for _, forbidden := range []string{
		"+998", `name="phone`, `data-phone`, "user_id", "UserID", "Residence Service",
		"ЖК", "TJM", "SAN’AT", "Avalon", "Mirador", "residential project", "every project",
	} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("privacy-minimal account page contains %q", forbidden)
		}
	}
	if strings.Contains(strings.ToLower(body), "<script") {
		t.Fatal("account UI must not contain scripts")
	}
	assertSecurityHeaders(t, recorder)
}

func TestRenderAccountLanguagesAndSafeLanguageLinks(t *testing.T) {
	for _, test := range []struct{ language, text string }{
		{"ru", "Аккаунт и сессии"}, {"uz", "Akkaunt va sessiyalar"}, {"en", "Account and sessions"},
	} {
		t.Run(test.language, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			if err := RenderAccount(recorder, AccountModel{Language: test.language}); err != nil {
				t.Fatal(err)
			}
			body := recorder.Body.String()
			assertContains(t, body, test.text)
			for _, language := range []string{"ru", "uz", "en"} {
				assertContains(t, body, `href="/__auth/account?lang=`+language+`"`)
			}
		})
	}
}
