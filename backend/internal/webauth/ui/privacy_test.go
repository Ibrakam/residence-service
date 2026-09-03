package ui

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRenderPrivacyContract(t *testing.T) {
	for _, test := range []struct {
		language string
		text     string
	}{
		{language: "ru", text: "Персональные данные и доступ."},
		{language: "uz", text: "Shaxsiy ma’lumotlar va kirish."},
		{language: "en", text: "Personal data and access."},
	} {
		t.Run(test.language, func(t *testing.T) {
			response := httptest.NewRecorder()
			if err := RenderPrivacy(response, PrivacyModel{Language: test.language}); err != nil {
				t.Fatal(err)
			}
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d", response.Code)
			}
			body := response.Body.String()
			for _, required := range []string{
				`<html lang="` + test.language + `"`, test.text,
				`href="/__auth/account?lang=` + test.language + `"`,
				`href="/privacy?lang=ru"`, `href="/privacy?lang=uz"`, `href="/privacy?lang=en"`,
				`998 78 113 77 12`, `Telegram`, `30`,
			} {
				assertContains(t, body, required)
			}
			if strings.Contains(strings.ToLower(body), "<script") || strings.Contains(body, "Residence Service") {
				t.Fatal("privacy page must be self-contained and brand-neutral")
			}
			assertSecurityHeaders(t, response)
		})
	}
}

func TestRenderPrivacyUsesConfiguredRetention(t *testing.T) {
	response := httptest.NewRecorder()
	if err := RenderPrivacy(response, PrivacyModel{
		Language: "en", TransactionTTL: 17 * time.Minute, SessionTTL: 42 * 24 * time.Hour,
	}); err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{"up to 17 minutes", "up to 42 days"} {
		assertContains(t, response.Body.String(), required)
	}
}
