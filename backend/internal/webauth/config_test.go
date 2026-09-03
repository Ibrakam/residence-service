package webauth

import (
	"strings"
	"testing"
	"time"
)

func TestConfigRejectsNonLoopbackAndProductionIssuerOverride(t *testing.T) {
	cfg := testConfig()
	cfg.Address = "0.0.0.0:4340"
	if err := cfg.Validate(); err == nil {
		t.Fatal("accepted non-loopback bind")
	}
	cfg = testConfig()
	cfg.OIDCIssuer = "https://login.evil.example"
	if err := cfg.Validate(); err == nil {
		t.Fatal("accepted a custom production issuer")
	}
	cfg.PublicOrigin = "http://127.0.0.1:3000"
	cfg.OIDCIssuer = "http://127.0.0.1:9000"
	if err := cfg.Validate(); err != nil {
		t.Fatalf("loopback test issuer rejected: %v", err)
	}
}

func TestConfigRequiresDedicatedBotSecretsOnlyWhenWebhookEnabled(t *testing.T) {
	cfg := testConfig()
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
	cfg.BotWebhookEnabled = true
	if err := cfg.Validate(); err == nil {
		t.Fatal("enabled webhook without credentials")
	}
	cfg.BotToken = "123456:abcdefghijklmnopqrstuvwxyz_123456789"
	cfg.BotWebhookSecret = strings.Repeat("a", 32)
	if err := cfg.Validate(); err != nil {
		t.Fatalf("valid bot webhook config rejected: %v", err)
	}
}

func TestLoadConfigFailsClosedOnInvalidValues(t *testing.T) {
	for _, key := range []string{
		"AUTH_GATEWAY_ADDR", "DATABASE_URL", "MIGRATIONS_DIR", "AUTH_PUBLIC_ORIGIN",
		"TELEGRAM_OIDC_ISSUER", "TELEGRAM_OIDC_CLIENT_ID", "TELEGRAM_OIDC_CLIENT_SECRET",
		"AUTH_AUTO_MIGRATE", "AUTH_SESSION_TTL", "AUTH_TRANSACTION_TTL", "AUTH_SHUTDOWN_TIMEOUT",
		"AUTH_OIDC_HTTP_TIMEOUT", "AUTH_BOT_WEBHOOK_ENABLED", "TELEGRAM_AUTH_BOT_TOKEN", "TELEGRAM_AUTH_WEBHOOK_SECRET",
	} {
		t.Setenv(key, "")
	}
	t.Setenv("DATABASE_URL", "postgres://db")
	t.Setenv("AUTH_PUBLIC_ORIGIN", "https://form.tencorp.uz")
	t.Setenv("TELEGRAM_OIDC_CLIENT_ID", "123456")
	t.Setenv("TELEGRAM_OIDC_CLIENT_SECRET", "0123456789abcdef")
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Address != "127.0.0.1:4340" || cfg.SessionTTL != 30*24*time.Hour || cfg.TransactionTTL != 10*time.Minute || cfg.BotWebhookEnabled {
		t.Fatalf("defaults = %#v", cfg)
	}
	t.Setenv("TELEGRAM_AUTH_BOT_TOKEN", "ignored-invalid-token")
	t.Setenv("TELEGRAM_AUTH_WEBHOOK_SECRET", "ignored")
	cfg, err = LoadConfig()
	if err != nil || cfg.BotToken != "" || cfg.BotWebhookSecret != "" {
		t.Fatalf("disabled webhook loaded optional secrets: token=%v secret=%v err=%v", cfg.BotToken != "", cfg.BotWebhookSecret != "", err)
	}
	t.Setenv("AUTH_AUTO_MIGRATE", "sometimes")
	if _, err := LoadConfig(); err == nil {
		t.Fatal("accepted invalid boolean")
	}
}
