package ui

import (
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/base64"
	"fmt"
	"html/template"
	"net/http"
	"net/url"
)

//go:embed page.html
var pageHTML string

//go:embed styles.css
var stylesCSS string

var pageTemplate = template.Must(template.New("authorization-page").Parse(pageHTML))

var stylesheetPolicy = func() string {
	digest := sha256.Sum256([]byte(stylesCSS))
	return "'sha256-" + base64.StdEncoding.EncodeToString(digest[:]) + "'"
}()

type languageLink struct {
	Code    string
	URL     template.URL
	Current bool
}

type pageView struct {
	Styles       template.CSS
	Language     string
	Direction    string
	ReturnTo     string
	CSRFToken    string
	LoginURL     template.URL
	PrivacyURL   template.URL
	Languages    []languageLink
	Copy         copybook
	IsError      bool
	ErrorTitle   string
	ErrorMessage string
	Notice       string
}

// RenderLogin writes the localized Telegram authorization page.
func RenderLogin(response http.ResponseWriter, model Model) error {
	return render(response, model, false)
}

// RenderError writes a localized, non-reflective authorization error page.
// StatusCode defaults to 500 and is constrained to the HTTP error range.
func RenderError(response http.ResponseWriter, model Model) error {
	return render(response, model, true)
}

func render(response http.ResponseWriter, model Model, isError bool) error {
	selectedLanguage := resolveLanguage(model.Language, model.AcceptLanguage)
	returnTo := safeReturnTo(model.ReturnTo)
	copy := translations[selectedLanguage]
	errorTitle, errorMessage := localizedError(copy, model.ErrorCode)
	view := pageView{
		Styles:       template.CSS(stylesCSS), // stylesCSS is a compile-time embedded, reviewed asset.
		Language:     string(selectedLanguage),
		Direction:    "ltr",
		ReturnTo:     returnTo,
		CSRFToken:    model.CSRFToken,
		LoginURL:     loginURL(selectedLanguage, returnTo),
		PrivacyURL:   privacyURL(selectedLanguage),
		Languages:    languageLinks(selectedLanguage, returnTo),
		Copy:         copy,
		IsError:      isError,
		ErrorTitle:   errorTitle,
		ErrorMessage: errorMessage,
		Notice:       localizedNotice(copy, model.ErrorCode),
	}

	var body bytes.Buffer
	if err := pageTemplate.Execute(&body, view); err != nil {
		return fmt.Errorf("render authorization page: %w", err)
	}

	setSecurityHeaders(response, selectedLanguage, model.NoReferrer)
	if isError {
		response.WriteHeader(errorStatus(model.StatusCode))
	} else {
		response.WriteHeader(http.StatusOK)
	}
	if _, err := response.Write(body.Bytes()); err != nil {
		return fmt.Errorf("write authorization page: %w", err)
	}
	return nil
}

func setSecurityHeaders(response http.ResponseWriter, selectedLanguage language, noReferrer bool) {
	headers := response.Header()
	headers.Set("Content-Type", "text/html; charset=utf-8")
	headers.Set("Content-Language", string(selectedLanguage))
	headers.Set("Cache-Control", "no-store, max-age=0")
	headers.Set("Pragma", "no-cache")
	headers.Set("X-Content-Type-Options", "nosniff")
	headers.Set("X-Frame-Options", "DENY")
	referrerPolicy := "same-origin"
	if noReferrer {
		referrerPolicy = "no-referrer"
	}
	headers.Set("Referrer-Policy", referrerPolicy)
	headers.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
	headers.Set(
		"Content-Security-Policy",
		"default-src 'none'; style-src "+stylesheetPolicy+"; img-src 'self'; font-src 'self'; form-action 'self' https://oauth.telegram.org; base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
	)
}

func privacyURL(selectedLanguage language) template.URL {
	query := url.Values{}
	query.Set("lang", string(selectedLanguage))
	return template.URL("/privacy?" + query.Encode())
}

func errorStatus(status int) int {
	if status < 400 || status > 599 {
		return http.StatusInternalServerError
	}
	return status
}

func loginURL(selectedLanguage language, returnTo string) template.URL {
	query := url.Values{}
	query.Set("lang", string(selectedLanguage))
	query.Set("return_to", returnTo)
	return template.URL("/__auth/login?" + query.Encode())
}

func languageLinks(selectedLanguage language, returnTo string) []languageLink {
	links := make([]languageLink, 0, 3)
	for _, candidate := range []language{languageRU, languageUZ, languageEN} {
		links = append(links, languageLink{
			Code:    string(candidate),
			URL:     loginURL(candidate, returnTo),
			Current: candidate == selectedLanguage,
		})
	}
	return links
}

func localizedError(copy copybook, code string) (string, string) {
	switch code {
	case "telegram_denied", "login_cancelled":
		return copy.ErrorDeniedTitle, copy.ErrorDeniedMessage
	case "telegram_expired", "state_expired", "expired_login", "invalid_login_state":
		return copy.ErrorExpiredTitle, copy.ErrorExpiredMessage
	case "phone_required", "phone_unverified":
		return copy.ErrorPhoneTitle, copy.ErrorPhoneMessage
	case "account_blocked":
		return copy.ErrorAccessTitle, copy.ErrorAccessMessage
	default:
		return copy.ErrorDefaultTitle, copy.ErrorDefaultMessage
	}
}

func localizedNotice(copy copybook, code string) string {
	switch code {
	case "session_expired":
		return copy.SessionExpiredNotice
	case "phone_required":
		return copy.PhoneRequiredNotice
	default:
		return ""
	}
}
