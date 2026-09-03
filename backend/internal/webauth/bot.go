package webauth

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

type botMessenger interface {
	SendLoginLink(context.Context, int64, string, string) error
}

type TelegramBot struct {
	token  string
	client *http.Client
}

func NewTelegramBot(token string, timeout time.Duration) (*TelegramBot, error) {
	if !validBotToken(token) {
		return nil, errors.New("invalid Telegram auth bot token")
	}
	if timeout < time.Second || timeout > 10*time.Second {
		return nil, errors.New("invalid Telegram auth bot timeout")
	}
	return &TelegramBot{
		token:  token,
		client: directHTTPClient(timeout),
	}, nil
}

func (bot *TelegramBot) SendLoginLink(ctx context.Context, chatID int64, publicOrigin, languageCode string) error {
	if chatID <= 0 {
		return errors.New("invalid private chat")
	}
	message, siteButton, accountButton := botLoginCopy(languageCode)
	payload := map[string]any{
		"chat_id":              chatID,
		"text":                 message,
		"link_preview_options": map[string]bool{"is_disabled": true},
		"reply_markup": map[string]any{"inline_keyboard": [][]map[string]string{
			{{"text": siteButton, "url": publicOrigin + "/"}},
			{{"text": accountButton, "url": publicOrigin + "/__auth/account"}},
		}},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return errors.New("encode Telegram message")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.telegram.org/bot"+bot.token+"/sendMessage", bytes.NewReader(body))
	if err != nil {
		return errors.New("create Telegram request")
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := bot.client.Do(request)
	if err != nil {
		return errors.New("send Telegram message")
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	if err != nil {
		return errors.New("read Telegram response")
	}
	var envelope struct {
		OK bool `json:"ok"`
	}
	if response.StatusCode != http.StatusOK || json.Unmarshal(responseBody, &envelope) != nil || !envelope.OK {
		return errors.New("Telegram rejected message")
	}
	return nil
}

type telegramWebhookUpdate struct {
	Message *struct {
		Text string `json:"text"`
		From *struct {
			IsBot        bool   `json:"is_bot"`
			LanguageCode string `json:"language_code"`
		} `json:"from"`
		Chat struct {
			ID   int64  `json:"id"`
			Type string `json:"type"`
		} `json:"chat"`
	} `json:"message"`
}

func (server *Server) handleBotWebhook(response http.ResponseWriter, request *http.Request) {
	provided := request.Header.Values("X-Telegram-Bot-Api-Secret-Token")
	providedValue := ""
	if len(provided) == 1 {
		providedValue = provided[0]
	}
	providedHash := tokenHash(providedValue)
	if len(provided) != 1 || subtle.ConstantTimeCompare(providedHash[:], server.botWebhookSecret[:]) != 1 {
		writeJSON(response, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	contentTypes := request.Header.Values("Content-Type")
	if len(contentTypes) != 1 || strings.ToLower(strings.TrimSpace(strings.Split(contentTypes[0], ";")[0])) != "application/json" {
		writeJSON(response, http.StatusUnsupportedMediaType, map[string]string{"error": "content_type_required"})
		return
	}
	request.Body = http.MaxBytesReader(response, request.Body, 64<<10)
	decoder := json.NewDecoder(request.Body)
	var update telegramWebhookUpdate
	if err := decoder.Decode(&update); err != nil {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid_update"})
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "invalid_update"})
		return
	}
	if update.Message == nil || update.Message.From == nil || update.Message.From.IsBot || update.Message.Chat.Type != "private" || update.Message.Chat.ID <= 0 || !isLoginBotCommand(update.Message.Text) {
		writeJSON(response, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	if err := server.bot.SendLoginLink(request.Context(), update.Message.Chat.ID, server.cfg.PublicOrigin, update.Message.From.LanguageCode); err != nil {
		server.logEvent(slog.LevelError, eventBotWebhook, outcomeSendFailed)
		writeJSON(response, http.StatusBadGateway, map[string]string{"error": "telegram_unavailable"})
		return
	}
	writeJSON(response, http.StatusOK, map[string]bool{"ok": true})
}

func botLoginCopy(languageCode string) (string, string, string) {
	languageCode = strings.ToLower(strings.TrimSpace(languageCode))
	if separator := strings.IndexAny(languageCode, "-_"); separator >= 0 {
		languageCode = languageCode[:separator]
	}
	switch languageCode {
	case "uz":
		return "TENCORP Access Telegram orqali xavfsiz kirishni taqdim etadi. Saytni ochish va kirishni tasdiqlash uchun tugmani bosing.", "TENCORP’ni ochish", "Kirishni boshqarish"
	case "en":
		return "TENCORP Access uses Telegram for secure sign-in. Tap the button to open the site and confirm access.", "Open TENCORP", "Manage access"
	default:
		return "TENCORP Access использует Telegram для безопасного входа. Нажмите кнопку, чтобы открыть сайт и подтвердить доступ.", "Открыть TENCORP", "Управление доступом"
	}
}

func isLoginBotCommand(text string) bool {
	fields := strings.Fields(strings.TrimSpace(text))
	if len(fields) == 0 {
		return false
	}
	command := strings.ToLower(strings.SplitN(fields[0], "@", 2)[0])
	return command == "/start" || command == "/help"
}
