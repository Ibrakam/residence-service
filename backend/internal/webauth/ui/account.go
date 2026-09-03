package ui

import (
	"bytes"
	_ "embed"
	"fmt"
	"html/template"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

//go:embed account.html
var accountHTML string

var accountTemplate = template.Must(template.New("account-page").Parse(accountHTML))

type accountCopy struct {
	PageTitle          string
	PageDescription    string
	SkipLink           string
	LanguageNavigation string
	BrandService       string
	CardEyebrow        string
	CardTitle          string
	CardLead           string
	FallbackName       string
	TelegramID         string
	Session            string
	SessionActive      string
	SessionUntil       string
	Logout             string
	LogoutNote         string
	LogoutAll          string
	LogoutAllNote      string
	BackToSite         string
	Privacy            string
	Footer             string
	SecurityFooter     string
}

var accountTranslations = map[language]accountCopy{
	languageRU: {
		PageTitle: "Аккаунт — TENCORP", PageDescription: "Управление активной Telegram-сессией TENCORP.",
		SkipLink: "Перейти к управлению сессией", LanguageNavigation: "Выбор языка", BrandService: "Access",
		CardEyebrow: "TENCORP ID", CardTitle: "Аккаунт и сессии",
		CardLead: "Проверьте Telegram-аккаунт и при необходимости завершите доступ на этом или на всех устройствах.", FallbackName: "Пользователь Telegram",
		TelegramID: "Telegram ID", Session: "Сессия", SessionActive: "Активна", SessionUntil: "до",
		Logout: "Выйти на этом устройстве", LogoutNote: "Завершить только текущую сессию",
		LogoutAll: "Выйти на всех устройствах", LogoutAllNote: "Завершить все активные сессии аккаунта",
		BackToSite: "Вернуться на сайт", Privacy: "Обработка персональных данных",
		Footer: "© 2026 TENCORP", SecurityFooter: "Telegram OIDC · серверная сессия",
	},
	languageUZ: {
		PageTitle: "Akkaunt — TENCORP", PageDescription: "TENCORP Telegram sessiyasini boshqarish.",
		SkipLink: "Sessiya boshqaruviga o‘tish", LanguageNavigation: "Tilni tanlash", BrandService: "Access",
		CardEyebrow: "TENCORP ID", CardTitle: "Akkaunt va sessiyalar",
		CardLead: "Telegram akkauntingizni tekshiring va kerak bo‘lsa shu yoki barcha qurilmalardagi kirishni yakunlang.", FallbackName: "Telegram foydalanuvchisi",
		TelegramID: "Telegram ID", Session: "Sessiya", SessionActive: "Faol", SessionUntil: "gacha",
		Logout: "Bu qurilmadan chiqish", LogoutNote: "Faqat joriy sessiyani yakunlash",
		LogoutAll: "Barcha qurilmalardan chiqish", LogoutAllNote: "Akkauntning barcha faol sessiyalarini yakunlash",
		BackToSite: "Saytga qaytish", Privacy: "Shaxsiy ma’lumotlarni qayta ishlash",
		Footer: "© 2026 TENCORP", SecurityFooter: "Telegram OIDC · server sessiyasi",
	},
	languageEN: {
		PageTitle: "Account — TENCORP", PageDescription: "Manage your active TENCORP Telegram session.",
		SkipLink: "Skip to session controls", LanguageNavigation: "Choose language", BrandService: "Access",
		CardEyebrow: "TENCORP ID", CardTitle: "Account and sessions",
		CardLead: "Check your Telegram account and end access on this device or every device whenever you need to.", FallbackName: "Telegram user",
		TelegramID: "Telegram ID", Session: "Session", SessionActive: "Active", SessionUntil: "until",
		Logout: "Sign out on this device", LogoutNote: "End only the current session",
		LogoutAll: "Sign out on every device", LogoutAllNote: "End every active session for this account",
		BackToSite: "Return to site", Privacy: "Personal data processing",
		Footer: "© 2026 TENCORP", SecurityFooter: "Telegram OIDC · server-side session",
	},
}

type accountView struct {
	Styles        template.CSS
	Language      string
	Languages     []languageLink
	PrivacyURL    template.URL
	Copy          accountCopy
	Name          string
	Username      string
	TelegramID    string
	ExpiresAt     string
	ExpiresAtISO  string
	HasExpiration bool
}

// RenderAccount writes a privacy-minimal page for inspecting and ending the
// authenticated browser session.
func RenderAccount(response http.ResponseWriter, model AccountModel) error {
	selectedLanguage := resolveLanguage(model.Language, model.AcceptLanguage)
	copy := accountTranslations[selectedLanguage]
	name := strings.TrimSpace(model.Name)
	if name == "" {
		name = copy.FallbackName
	}
	username := strings.TrimPrefix(strings.TrimSpace(model.Username), "@")
	if username != "" {
		username = "@" + username
	}
	telegramID := ""
	if model.TelegramID > 0 {
		telegramID = strconv.FormatInt(model.TelegramID, 10)
	}

	view := accountView{
		Styles:     template.CSS(stylesCSS), // stylesCSS is a compile-time embedded, reviewed asset.
		Language:   string(selectedLanguage),
		Languages:  accountLanguageLinks(selectedLanguage),
		PrivacyURL: privacyURL(selectedLanguage),
		Copy:       copy,
		Name:       name,
		Username:   username,
		TelegramID: telegramID,
	}
	if !model.SessionExpiresAt.IsZero() {
		expiry := model.SessionExpiresAt.UTC()
		view.HasExpiration = true
		view.ExpiresAt = expiry.Format("2006-01-02 · 15:04 UTC")
		view.ExpiresAtISO = expiry.Format(time.RFC3339)
	}

	var body bytes.Buffer
	if err := accountTemplate.Execute(&body, view); err != nil {
		return fmt.Errorf("render account page: %w", err)
	}
	setSecurityHeaders(response, selectedLanguage, false)
	response.WriteHeader(http.StatusOK)
	if _, err := response.Write(body.Bytes()); err != nil {
		return fmt.Errorf("write account page: %w", err)
	}
	return nil
}

func accountLanguageLinks(selectedLanguage language) []languageLink {
	links := make([]languageLink, 0, 3)
	for _, candidate := range []language{languageRU, languageUZ, languageEN} {
		query := url.Values{"lang": []string{string(candidate)}}
		links = append(links, languageLink{
			Code: string(candidate), URL: template.URL("/__auth/account?" + query.Encode()), Current: candidate == selectedLanguage,
		})
	}
	return links
}
