package ui

import (
	"bytes"
	_ "embed"
	"fmt"
	"html/template"
	"net/http"
	"net/url"
	"time"
)

//go:embed privacy.html
var privacyHTML string

var privacyTemplate = template.Must(template.New("privacy-page").Parse(privacyHTML))

type PrivacyModel struct {
	Language       string
	AcceptLanguage string
	TransactionTTL time.Duration
	SessionTTL     time.Duration
}

type privacyCopy struct {
	PageTitle          string
	PageDescription    string
	SkipLink           string
	LanguageNavigation string
	TopbarLabel        string
	ActionsLabel       string
	Eyebrow            string
	Title              string
	Lead               string
	DataTitle          string
	DataText           string
	PurposeTitle       string
	PurposeText        string
	RetentionTitle     string
	RetentionText      string
	RecipientsTitle    string
	RecipientsText     string
	ControlTitle       string
	ControlBefore      string
	ControlAccount     string
	ControlMiddle      string
	ControlPhone       string
	SecurityTitle      string
	SecurityText       string
	BackToSite         string
	Account            string
	Footer             string
	SecurityFooter     string
}

var privacyTranslations = map[language]privacyCopy{
	languageRU: {
		PageTitle: "Персональные данные — TENCORP", PageDescription: "Как TENCORP обрабатывает данные для Telegram-входа и обращений.",
		SkipLink: "Перейти к политике", LanguageNavigation: "Выбор языка", TopbarLabel: "Данные и приватность", ActionsLabel: "Действия с доступом", Eyebrow: "Приватность / 01",
		Title:           "Персональные данные и доступ.",
		Lead:            "Здесь описано, какие данные нужны для единого входа в закрытые сервисы TENCORP и как ими можно управлять.",
		DataTitle:       "Какие данные мы получаем",
		DataText:        "Для входа через Telegram: идентификатор Telegram, имя, username, адрес изображения профиля, подтверждённый номер телефона и технические данные защищённой сессии. В формах обращений отдельно могут обрабатываться имя, телефон, выбранный проект или объект и источник обращения.",
		PurposeTitle:    "Для чего",
		PurposeText:     "Чтобы подтвердить личность, предоставить единый доступ, защищать сессии и отвечать на обращения. Номер, полученный при авторизации, не используется для иной цели без отдельного основания или согласия.",
		RetentionTitle:  "Срок хранения",
		RetentionText:   "Транзакция подтверждения действует до %d мин. Сессия действует до %d дн. или до выхода. Данные Telegram-аккаунта хранятся до отключения доступа или выполнения обоснованного запроса на удаление, если закон не требует сохранить их дольше. Данные обращений хранятся только на срок, необходимый для ответа и выполнения обязательств.",
		RecipientsTitle: "Кому доступны данные",
		RecipientsText:  "Telegram участвует как поставщик входа. Данные доступны уполномоченным сотрудникам TENCORP и техническим поставщикам хостинга и базы данных только в объёме, необходимом для работы сервиса. Мы не продаём и не публикуем персональные данные.",
		ControlTitle:    "Как управлять данными",
		ControlBefore:   "Завершить текущую или все сессии можно на странице", ControlAccount: "управления доступом", ControlMiddle: ". Для уточнения, исправления или удаления данных обратитесь по телефону", ControlPhone: "+998 78 113 77 12",
		SecurityTitle: "Как защищён вход",
		SecurityText:  "Пароль Telegram не передаётся TENCORP. Браузер хранит только защищённые HttpOnly cookie без персональных данных, а сервер — необратимый хэш токена сессии. Номер телефона не возвращается сайтам через браузерный API.",
		BackToSite:    "Вернуться на сайт", Account: "Управление доступом", Footer: "© 2026 TENCORP", SecurityFooter: "Telegram OIDC · privacy",
	},
	languageUZ: {
		PageTitle: "Shaxsiy ma’lumotlar — TENCORP", PageDescription: "TENCORP Telegram orqali kirish va murojaatlar uchun ma’lumotlarni qanday qayta ishlaydi.",
		SkipLink: "Maxfiylik siyosatiga o‘tish", LanguageNavigation: "Tilni tanlash", TopbarLabel: "Ma’lumotlar va maxfiylik", ActionsLabel: "Kirish amallari", Eyebrow: "Maxfiylik / 01",
		Title:           "Shaxsiy ma’lumotlar va kirish.",
		Lead:            "Bu yerda TENCORP yopiq xizmatlariga yagona kirish uchun qaysi ma’lumotlar kerakligi va ularni qanday boshqarish mumkinligi tushuntiriladi.",
		DataTitle:       "Qanday ma’lumotlarni olamiz",
		DataText:        "Telegram orqali kirish uchun: Telegram identifikatori, ism, username, profil rasmi manzili, tasdiqlangan telefon raqami va himoyalangan sessiyaning texnik ma’lumotlari. Murojaat shakllarida ism, telefon, tanlangan loyiha yoki obyekt va murojaat manbasi alohida qayta ishlanishi mumkin.",
		PurposeTitle:    "Nima uchun",
		PurposeText:     "Shaxsni tasdiqlash, yagona kirishni taqdim etish, sessiyalarni himoya qilish va murojaatlarga javob berish uchun. Avtorizatsiya paytida olingan raqam boshqa maqsadda alohida asos yoki roziliksiz ishlatilmaydi.",
		RetentionTitle:  "Saqlash muddati",
		RetentionText:   "Kirishni tasdiqlash tranzaksiyasi %d daqiqagacha amal qiladi. Sessiya %d kungacha yoki chiqishgacha amal qiladi. Telegram akkaunt ma’lumotlari kirish o‘chirilguncha yoki asosli o‘chirish so‘rovi bajarilguncha saqlanadi, agar qonun uzoqroq muddatni talab qilmasa. Murojaat ma’lumotlari javob va majburiyatlar uchun zarur muddatgacha saqlanadi.",
		RecipientsTitle: "Ma’lumotlar kimga ochiq",
		RecipientsText:  "Telegram kirish provayderi sifatida qatnashadi. Ma’lumotlar faqat xizmat ishlashi uchun zarur hajmda TENCORP vakolatli xodimlari hamda hosting va ma’lumotlar bazasi texnik provayderlariga ochiq. Biz shaxsiy ma’lumotlarni sotmaymiz yoki ommaga e’lon qilmaymiz.",
		ControlTitle:    "Ma’lumotlarni boshqarish",
		ControlBefore:   "Joriy yoki barcha sessiyalarni", ControlAccount: "kirishni boshqarish", ControlMiddle: " sahifasida yakunlash mumkin. Ma’lumotlarni aniqlashtirish, tuzatish yoki o‘chirish uchun qo‘ng‘iroq qiling:", ControlPhone: "+998 78 113 77 12",
		SecurityTitle: "Kirish qanday himoyalangan",
		SecurityText:  "Telegram paroli TENCORP’ga berilmaydi. Brauzerda shaxsiy ma’lumotsiz himoyalangan HttpOnly cookie fayllari, serverda esa sessiya tokenining qaytarib bo‘lmaydigan xeshi saqlanadi. Telefon raqami brauzer API orqali saytlarga qaytarilmaydi.",
		BackToSite:    "Saytga qaytish", Account: "Kirishni boshqarish", Footer: "© 2026 TENCORP", SecurityFooter: "Telegram OIDC · privacy",
	},
	languageEN: {
		PageTitle: "Personal data — TENCORP", PageDescription: "How TENCORP processes data for Telegram sign-in and enquiries.",
		SkipLink: "Skip to privacy policy", LanguageNavigation: "Choose language", TopbarLabel: "Data and privacy", ActionsLabel: "Access actions", Eyebrow: "Privacy / 01",
		Title:           "Personal data and access.",
		Lead:            "This page explains which data is required for shared access to private TENCORP services and how you can control it.",
		DataTitle:       "Data we receive",
		DataText:        "For Telegram sign-in: Telegram identifier, name, username, profile image address, verified phone number, and technical protected-session data. Enquiry forms may separately process a name, phone number, selected project or unit, and enquiry source.",
		PurposeTitle:    "Why we use it",
		PurposeText:     "To verify identity, provide shared access, protect sessions, and respond to enquiries. A phone number received during authorization is not used for another purpose without a separate legal basis or consent.",
		RetentionTitle:  "Retention",
		RetentionText:   "A sign-in transaction is valid for up to %d minutes. A session lasts up to %d days or until sign-out. Telegram account data is kept until access is disabled or a valid deletion request is completed, unless law requires longer retention. Enquiry data is kept only as long as needed to respond and meet applicable obligations.",
		RecipientsTitle: "Who can access data",
		RecipientsText:  "Telegram participates as the identity provider. Data is available to authorized TENCORP staff and technical hosting and database providers only to the extent needed to operate the service. We do not sell or publish personal data.",
		ControlTitle:    "Your controls",
		ControlBefore:   "End the current session or every session on the", ControlAccount: "access management", ControlMiddle: " page. To request access, correction, or deletion, call", ControlPhone: "+998 78 113 77 12",
		SecurityTitle: "How sign-in is protected",
		SecurityText:  "Your Telegram password is never shared with TENCORP. The browser stores only protected HttpOnly cookies without personal data, while the server stores an irreversible session-token hash. The phone number is not returned to sites through the browser API.",
		BackToSite:    "Return to site", Account: "Manage access", Footer: "© 2026 TENCORP", SecurityFooter: "Telegram OIDC · privacy",
	},
}

type privacyView struct {
	Styles    template.CSS
	Language  string
	Languages []languageLink
	Copy      privacyCopy
}

func RenderPrivacy(response http.ResponseWriter, model PrivacyModel) error {
	selectedLanguage := resolveLanguage(model.Language, model.AcceptLanguage)
	copy := privacyTranslations[selectedLanguage]
	copy.RetentionText = fmt.Sprintf(copy.RetentionText,
		roundUpDuration(model.TransactionTTL, time.Minute, 10*time.Minute),
		roundUpDuration(model.SessionTTL, 24*time.Hour, 30*24*time.Hour),
	)
	view := privacyView{
		Styles: template.CSS(stylesCSS), Language: string(selectedLanguage),
		Languages: privacyLanguageLinks(selectedLanguage), Copy: copy,
	}
	var body bytes.Buffer
	if err := privacyTemplate.Execute(&body, view); err != nil {
		return fmt.Errorf("render privacy page: %w", err)
	}
	setSecurityHeaders(response, selectedLanguage, false)
	response.WriteHeader(http.StatusOK)
	if _, err := response.Write(body.Bytes()); err != nil {
		return fmt.Errorf("write privacy page: %w", err)
	}
	return nil
}

func roundUpDuration(value, unit, fallback time.Duration) int64 {
	if value <= 0 {
		value = fallback
	}
	return int64((value + unit - 1) / unit)
}

func privacyLanguageLinks(selectedLanguage language) []languageLink {
	links := make([]languageLink, 0, 3)
	for _, candidate := range []language{languageRU, languageUZ, languageEN} {
		query := url.Values{"lang": []string{string(candidate)}}
		links = append(links, languageLink{
			Code: string(candidate), URL: template.URL("/privacy?" + query.Encode()), Current: candidate == selectedLanguage,
		})
	}
	return links
}
