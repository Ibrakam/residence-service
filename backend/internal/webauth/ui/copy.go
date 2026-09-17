package ui

type copybook struct {
	PageTitle            string
	ErrorPageTitle       string
	PageDescription      string
	SkipLink             string
	LanguageNavigation   string
	BrandService         string
	CardEyebrow          string
	CardTitle            string
	CTA                  string
	CTANote              string
	PrivacyBefore        string
	PrivacyLink          string
	PrivacyAfter         string
	SessionTitle         string
	SessionText          string
	SecurityFooter       string
	SessionExpiredNotice string
	PhoneRequiredNotice  string
	ErrorEyebrow         string
	Retry                string
	BackToLogin          string
	ErrorDefaultTitle    string
	ErrorDefaultMessage  string
	ErrorDeniedTitle     string
	ErrorDeniedMessage   string
	ErrorExpiredTitle    string
	ErrorExpiredMessage  string
	ErrorPhoneTitle      string
	ErrorPhoneMessage    string
	ErrorAccessTitle     string
	ErrorAccessMessage   string
	Footer               string
}

var translations = map[language]copybook{
	languageRU: {
		PageTitle:            "Вход — TENCORP",
		ErrorPageTitle:       "Не удалось войти — TENCORP",
		PageDescription:      "Безопасный вход в TENCORP через Telegram.",
		SkipLink:             "Перейти к форме входа",
		LanguageNavigation:   "Выбор языка",
		BrandService:         "Access",
		CardEyebrow:          "TENCORP ID",
		CardTitle:            "Войти через Telegram",
		CTA:                  "Продолжить через Telegram",
		CTANote:              "Без пароля · подтверждение в Telegram",
		PrivacyBefore:        "Продолжая, вы принимаете условия",
		PrivacyLink:          "обработки персональных данных",
		PrivacyAfter:         ".",
		SessionTitle:         "Одна защищённая сессия",
		SessionText:          "Вход сохранится на этом устройстве; завершить его можно в любое время.",
		SecurityFooter:       "Telegram OIDC · серверная сессия",
		SessionExpiredNotice: "Сессия завершилась. Войдите снова, чтобы продолжить с той же страницы.",
		PhoneRequiredNotice:  "Для входа подтвердите в Telegram номер, привязанный к вашему аккаунту.",
		ErrorEyebrow:         "Вход не завершён",
		Retry:                "Попробовать снова",
		BackToLogin:          "Вернуться ко входу",
		ErrorDefaultTitle:    "Не удалось завершить вход",
		ErrorDefaultMessage:  "Произошла временная ошибка. Повторите попытку — предыдущая страница сохранена.",
		ErrorDeniedTitle:     "Вход отменён",
		ErrorDeniedMessage:   "Telegram не подтвердил вход. Вы можете безопасно начать авторизацию ещё раз.",
		ErrorExpiredTitle:    "Время подтверждения истекло",
		ErrorExpiredMessage:  "Ссылка авторизации больше не действует. Начните новый вход, чтобы продолжить.",
		ErrorPhoneTitle:      "Номер не подтверждён",
		ErrorPhoneMessage:    "Для доступа нужен номер, привязанный к Telegram-аккаунту. Повторите вход и разрешите его передачу.",
		ErrorAccessTitle:     "Аккаунт заблокирован",
		ErrorAccessMessage:   "Доступ для этого Telegram-аккаунта отключён. Обратитесь к администратору доступа.",
		Footer:               "© 2026 TENCORP",
	},
	languageUZ: {
		PageTitle:            "Kirish — TENCORP",
		ErrorPageTitle:       "Kirish amalga oshmadi — TENCORP",
		PageDescription:      "Telegram orqali TENCORP’ga xavfsiz kirish.",
		SkipLink:             "Kirish shakliga o‘tish",
		LanguageNavigation:   "Tilni tanlash",
		BrandService:         "Access",
		CardEyebrow:          "TENCORP ID",
		CardTitle:            "Telegram orqali kiring",
		CTA:                  "Telegram orqali davom etish",
		CTANote:              "Parolsiz · Telegram’da tasdiqlash",
		PrivacyBefore:        "Davom etish orqali siz",
		PrivacyLink:          "shaxsiy ma’lumotlarni qayta ishlash shartlarini",
		PrivacyAfter:         " qabul qilasiz.",
		SessionTitle:         "Bitta himoyalangan sessiya",
		SessionText:          "Kirish shu qurilmada saqlanadi va uni istalgan vaqtda yakunlash mumkin.",
		SecurityFooter:       "Telegram OIDC · server sessiyasi",
		SessionExpiredNotice: "Sessiya yakunlandi. Shu sahifadan davom etish uchun qayta kiring.",
		PhoneRequiredNotice:  "Kirish uchun Telegram akkauntingizga bog‘langan raqamni tasdiqlang.",
		ErrorEyebrow:         "Kirish yakunlanmadi",
		Retry:                "Qayta urinib ko‘rish",
		BackToLogin:          "Kirishga qaytish",
		ErrorDefaultTitle:    "Kirishni yakunlab bo‘lmadi",
		ErrorDefaultMessage:  "Vaqtinchalik xatolik yuz berdi. Qayta urinib ko‘ring — avvalgi sahifa saqlanib qoladi.",
		ErrorDeniedTitle:     "Kirish bekor qilindi",
		ErrorDeniedMessage:   "Telegram kirishni tasdiqlamadi. Avtorizatsiyani xavfsiz tarzda qayta boshlashingiz mumkin.",
		ErrorExpiredTitle:    "Tasdiqlash vaqti tugadi",
		ErrorExpiredMessage:  "Avtorizatsiya havolasi endi amal qilmaydi. Davom etish uchun yangi kirishni boshlang.",
		ErrorPhoneTitle:      "Raqam tasdiqlanmadi",
		ErrorPhoneMessage:    "Kirish uchun Telegram akkauntingizga bog‘langan raqam kerak. Qayta kiring va uni yuborishga ruxsat bering.",
		ErrorAccessTitle:     "Akkaunt bloklangan",
		ErrorAccessMessage:   "Bu Telegram akkaunti uchun kirish o‘chirilgan. Kirish administratoriga murojaat qiling.",
		Footer:               "© 2026 TENCORP",
	},
	languageEN: {
		PageTitle:            "Sign in — TENCORP",
		ErrorPageTitle:       "Sign-in unsuccessful — TENCORP",
		PageDescription:      "Secure Telegram sign-in for TENCORP.",
		SkipLink:             "Skip to sign-in",
		LanguageNavigation:   "Choose language",
		BrandService:         "Access",
		CardEyebrow:          "TENCORP ID",
		CardTitle:            "Sign in with Telegram",
		CTA:                  "Continue with Telegram",
		CTANote:              "No password · confirm in Telegram",
		PrivacyBefore:        "By continuing, you accept the",
		PrivacyLink:          "personal data processing terms",
		PrivacyAfter:         ".",
		SessionTitle:         "One protected session",
		SessionText:          "Sign-in stays active on this device and can be ended at any time.",
		SecurityFooter:       "Telegram OIDC · server-side session",
		SessionExpiredNotice: "Your session has ended. Sign in again to continue from the same page.",
		PhoneRequiredNotice:  "To sign in, confirm the number linked to your Telegram account.",
		ErrorEyebrow:         "Sign-in incomplete",
		Retry:                "Try again",
		BackToLogin:          "Return to sign-in",
		ErrorDefaultTitle:    "We could not complete sign-in",
		ErrorDefaultMessage:  "A temporary error occurred. Try again — the previous page has been preserved.",
		ErrorDeniedTitle:     "Sign-in was cancelled",
		ErrorDeniedMessage:   "Telegram did not confirm sign-in. You can safely start authorization again.",
		ErrorExpiredTitle:    "Confirmation has expired",
		ErrorExpiredMessage:  "This authorization link is no longer valid. Start a new sign-in to continue.",
		ErrorPhoneTitle:      "Phone not confirmed",
		ErrorPhoneMessage:    "Access requires the number linked to your Telegram account. Sign in again and allow it to be shared.",
		ErrorAccessTitle:     "Account blocked",
		ErrorAccessMessage:   "Access for this Telegram account has been disabled. Contact your access administrator.",
		Footer:               "© 2026 TENCORP",
	},
}
