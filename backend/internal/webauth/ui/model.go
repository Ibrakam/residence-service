package ui

import (
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// Model contains the request-scoped values needed by the authorization pages.
// Language is the explicit URL language and takes precedence over
// AcceptLanguage. ReturnTo is always normalized to a same-origin relative URL
// before it is rendered.
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

func resolveLanguage(explicit, acceptLanguage string) language {
	if selected, ok := languageFromTag(explicit); ok {
		return selected
	}

	selected := languageRU
	bestQuality := -1.0
	bestPosition := len(strings.Split(acceptLanguage, ",")) + 1
	for position, item := range strings.Split(acceptLanguage, ",") {
		parts := strings.Split(item, ";")
		candidate, ok := languageFromTag(parts[0])
		if !ok {
			continue
		}

		quality := 1.0
		for _, parameter := range parts[1:] {
			name, value, found := strings.Cut(strings.TrimSpace(parameter), "=")
			if !found || !strings.EqualFold(strings.TrimSpace(name), "q") {
				continue
			}
			parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
			if err != nil || parsed < 0 || parsed > 1 {
				quality = 0
			} else {
				quality = parsed
			}
		}
		if quality <= 0 {
			continue
		}
		if quality > bestQuality || (quality == bestQuality && position < bestPosition) {
			selected = candidate
			bestQuality = quality
			bestPosition = position
		}
	}
	return selected
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
