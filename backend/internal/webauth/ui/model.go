package ui

import (
	"net/url"
	"strings"
	"time"
	"unicode/utf8"
)

// Model contains the request-scoped values needed by the authorization pages.
// Language is an optional explicit URL language. When it is absent or invalid,
// pages deliberately open in Russian. ReturnTo is always normalized to a
// same-origin relative URL before it is rendered.
type Model struct {
	Language       string
	AcceptLanguage string
	ReturnTo       string
	CSRFToken      string
	ErrorCode      string
	StatusCode     int
	NoReferrer     bool
}

// AccountModel contains only the Telegram profile fields needed to identify the
// active session to its owner. The internal database ID and phone number are
// deliberately absent: neither is needed to end a session.
type AccountModel struct {
	Language         string
	AcceptLanguage   string
	Name             string
	Username         string
	TelegramID       int64
	SessionExpiresAt time.Time
}

type language string

const (
	languageRU language = "ru"
	languageUZ language = "uz"
	languageEN language = "en"
)

func resolveLanguage(explicit, _ string) language {
	if selected, ok := languageFromTag(explicit); ok {
		return selected
	}
	return languageRU
}

func languageFromTag(value string) (language, bool) {
	tag := strings.ToLower(strings.TrimSpace(value))
	if separator := strings.IndexAny(tag, "-_"); separator >= 0 {
		tag = tag[:separator]
	}
	switch language(tag) {
	case languageRU:
		return languageRU, true
	case languageUZ:
		return languageUZ, true
	case languageEN:
		return languageEN, true
	default:
		return "", false
	}
}

func safeReturnTo(value string) string {
	if value == "" {
		return "/"
	}
	if len(value) > 2048 || !utf8.ValidString(value) || !strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") {
		return "/"
	}
	if unsafeRedirectLayer(value) {
		return "/"
	}

	parsed, err := url.ParseRequestURI(value)
	if err != nil || parsed.IsAbs() || parsed.Host != "" || parsed.User != nil || parsed.Fragment != "" || parsed.Opaque != "" {
		return "/"
	}

	decoded := value
	for depth := 0; depth < 8 && strings.Contains(decoded, "%"); depth++ {
		next, decodeErr := url.PathUnescape(decoded)
		if decodeErr != nil || unsafeRedirectLayer(next) {
			return "/"
		}
		if next == decoded {
			break
		}
		decoded = next
	}
	if strings.Contains(decoded, "%") {
		if next, decodeErr := url.PathUnescape(decoded); decodeErr != nil || next != decoded {
			return "/"
		}
	}
	return value
}

func unsafeRedirectLayer(value string) bool {
	if strings.HasPrefix(value, "//") || strings.ContainsRune(value, '\\') {
		return true
	}
	for _, character := range value {
		if character < 0x20 || character == 0x7f {
			return true
		}
	}
	return false
}
