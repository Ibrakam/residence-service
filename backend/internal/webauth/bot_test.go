package webauth

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) { return fn(request) }

type recordingBot struct {
	chatID   int64
	origin   string
	language string
	err      error
}

func (bot *recordingBot) SendLoginLink(_ context.Context, chatID int64, origin, language string) error {
	bot.chatID, bot.origin, bot.language = chatID, origin, language
	return bot.err
}

func TestBotWebhookRequiresSecretAndRepliesOnlyToPrivateCommands(t *testing.T) {
	store := newMemoryStore()
	provider := &stubProvider{}
	bot := &recordingBot{}
	cfg := testConfig()
	cfg.BotWebhookEnabled = true
	cfg.BotToken = "123456:abcdefghijklmnopqrstuvwxyz_123456789"
	cfg.BotWebhookSecret = "0123456789abcdef0123456789abcdef"
	server, err := NewServer(cfg, store, provider, WithTelegramBot(bot))
	if err != nil {
		t.Fatal(err)
	}

	missingSecret := httptest.NewRequest(http.MethodPost, "https://form.tencorp.uz/__auth/telegram/bot-webhook", strings.NewReader(`{"message":{}}`))
	missingSecret.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, missingSecret)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("missing-secret status = %d", response.Code)
	}

	group := webhookRequest(cfg.BotWebhookSecret, `{"message":{"text":"/start","from":{"is_bot":false},"chat":{"id":-100,"type":"supergroup"}}}`)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, group)
	if response.Code != http.StatusOK || bot.chatID != 0 {
		t.Fatalf("group update status=%d chat=%d", response.Code, bot.chatID)
	}

	private := webhookRequest(cfg.BotWebhookSecret, `{"update_id":12,"message":{"text":"/start campaign","from":{"is_bot":false,"language_code":"uz-Cyrl"},"chat":{"id":5566,"type":"private"}}}`)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, private)
	if response.Code != http.StatusOK || bot.chatID != 5566 || bot.origin != cfg.PublicOrigin || bot.language != "uz-Cyrl" {
		t.Fatalf("private update status=%d bot=%#v", response.Code, bot)
	}
}

func TestBotWebhookRejectsDuplicateSecretMalformedAndOversizedInput(t *testing.T) {
	bot := &recordingBot{}
	cfg := testConfig()
	cfg.BotWebhookEnabled = true
	cfg.BotToken = "123456:abcdefghijklmnopqrstuvwxyz_123456789"
	cfg.BotWebhookSecret = "0123456789abcdef0123456789abcdef"
	server, err := NewServer(cfg, newMemoryStore(), &stubProvider{}, WithTelegramBot(bot))
	if err != nil {
		t.Fatal(err)
	}

	duplicate := webhookRequest(cfg.BotWebhookSecret, `{}`)
	duplicate.Header.Add("X-Telegram-Bot-Api-Secret-Token", cfg.BotWebhookSecret)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, duplicate)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("duplicate secret status = %d", response.Code)
	}

	malformed := webhookRequest(cfg.BotWebhookSecret, `{not-json}`)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, malformed)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("malformed status = %d", response.Code)
	}

	accepted := webhookRequest(cfg.BotWebhookSecret, `{"padding":"`+strings.Repeat("x", 20<<10)+`"}`)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, accepted)
	if response.Code != http.StatusOK {
		t.Fatalf("accepted bounded body status = %d", response.Code)
	}

	oversized := webhookRequest(cfg.BotWebhookSecret, `{"padding":"`+strings.Repeat("x", 65<<10)+`"}`)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, oversized)
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized status = %d", response.Code)
	}
}

func TestDisabledBotWebhookIsNotRouted(t *testing.T) {
	server, _, _ := testServer(t)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, webhookRequest("unused", `{}`))
	if response.Code != http.StatusNotFound {
		t.Fatalf("disabled webhook status = %d", response.Code)
	}
}

func TestTelegramBotSendsBoundedLoginMessageWithoutFollowingRedirects(t *testing.T) {
	const testToken = "123456:abcdefghijklmnopqrstuvwxyz_123456789"
	bot, err := NewTelegramBot(testToken, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	called := false
	bot.client.Transport = roundTripFunc(func(request *http.Request) (*http.Response, error) {
		called = true
		if request.Method != http.MethodPost || request.URL.Host != "api.telegram.org" || !strings.HasSuffix(request.URL.Path, "/sendMessage") {
			t.Fatalf("request = %s %s", request.Method, request.URL.Redacted())
		}
		var payload struct {
			ChatID      int64  `json:"chat_id"`
			Text        string `json:"text"`
			ReplyMarkup struct {
				InlineKeyboard [][]struct {
					Text string `json:"text"`
					URL  string `json:"url"`
				} `json:"inline_keyboard"`
			} `json:"reply_markup"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil || payload.ChatID != 77 || !strings.Contains(payload.Text, "secure sign-in") || payload.ReplyMarkup.InlineKeyboard[0][0].Text != "Open TENCORP" || payload.ReplyMarkup.InlineKeyboard[0][0].URL != "https://form.tencorp.uz/" || payload.ReplyMarkup.InlineKeyboard[1][0].Text != "Manage access" || payload.ReplyMarkup.InlineKeyboard[1][0].URL != "https://form.tencorp.uz/__auth/account" {
			t.Fatalf("payload = %#v, err = %v", payload, err)
		}
		return &http.Response{
			StatusCode: http.StatusOK, Header: make(http.Header),
			Body: io.NopCloser(strings.NewReader(`{"ok":true,"result":{}}`)), Request: request,
		}, nil
	})
	if err := bot.SendLoginLink(context.Background(), 77, "https://form.tencorp.uz", "en-US"); err != nil || !called {
		t.Fatalf("send = %v, called = %v", err, called)
	}
	redirectRequest, _ := http.NewRequest(http.MethodGet, "https://evil.example", nil)
	if err := bot.client.CheckRedirect(redirectRequest, nil); !errors.Is(err, http.ErrUseLastResponse) {
		t.Fatalf("redirect policy = %v", err)
	}
}

func webhookRequest(secret, body string) *http.Request {
	request := httptest.NewRequest(http.MethodPost, "https://form.tencorp.uz/__auth/telegram/bot-webhook", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Telegram-Bot-Api-Secret-Token", secret)
	return request
}
