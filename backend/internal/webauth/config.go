package webauth

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	TelegramIssuer = "https://oauth.telegram.org"
	SessionCookie  = "__Host-tencorp_session"
	BindingCookie  = "__Host-tencorp_auth_binding"
)

type Config struct {
	Address           string
	DatabaseURL       string
	MigrationsDir     string
	AutoMigrate       bool
	PublicOrigin      string
	OIDCIssuer        string
	OIDCClientID      string
	OIDCClientSecret  string
	BotWebhookEnabled bool
	BotToken          string
	BotWebhookSecret  string
	SessionTTL        time.Duration
	TransactionTTL    time.Duration
	ShutdownTimeout   time.Duration
	HTTPTimeout       time.Duration
}

func LoadConfig() (Config, error) {
	botWebhookEnabled, err := parseOptionalBool("AUTH_BOT_WEBHOOK_ENABLED", false)
	if err != nil {
		return Config{}, err
	}
	cfg := Config{
		Address:           envOr("AUTH_GATEWAY_ADDR", "127.0.0.1:4340"),
		DatabaseURL:       strings.TrimSpace(os.Getenv("DATABASE_URL")),
		MigrationsDir:     envOr("MIGRATIONS_DIR", "./migrations"),
		PublicOrigin:      strings.TrimRight(strings.TrimSpace(os.Getenv("AUTH_PUBLIC_ORIGIN")), "/"),
		OIDCIssuer:        strings.TrimRight(envOr("TELEGRAM_OIDC_ISSUER", TelegramIssuer), "/"),
		OIDCClientID:      strings.TrimSpace(os.Getenv("TELEGRAM_OIDC_CLIENT_ID")),
		OIDCClientSecret:  strings.TrimSpace(os.Getenv("TELEGRAM_OIDC_CLIENT_SECRET")),
		BotWebhookEnabled: botWebhookEnabled,
		SessionTTL:        30 * 24 * time.Hour,
		TransactionTTL:    10 * time.Minute,
		ShutdownTimeout:   15 * time.Second,
		HTTPTimeout:       10 * time.Second,
	}
	if cfg.BotWebhookEnabled {
		cfg.BotToken = strings.TrimSpace(os.Getenv("TELEGRAM_AUTH_BOT_TOKEN"))
		cfg.BotWebhookSecret = strings.TrimSpace(os.Getenv("TELEGRAM_AUTH_WEBHOOK_SECRET"))
	}
	if cfg.AutoMigrate, err = parseOptionalBool("AUTH_AUTO_MIGRATE", false); err != nil {
		return Config{}, err
	}
	if cfg.SessionTTL, err = parseOptionalDuration("AUTH_SESSION_TTL", cfg.SessionTTL); err != nil {
		return Config{}, err
	}
	if cfg.TransactionTTL, err = parseOptionalDuration("AUTH_TRANSACTION_TTL", cfg.TransactionTTL); err != nil {
		return Config{}, err
	}
	if cfg.ShutdownTimeout, err = parseOptionalDuration("AUTH_SHUTDOWN_TIMEOUT", cfg.ShutdownTimeout); err != nil {
		return Config{}, err
	}
	if cfg.HTTPTimeout, err = parseOptionalDuration("AUTH_OIDC_HTTP_TIMEOUT", cfg.HTTPTimeout); err != nil {
		return Config{}, err
	}
	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (cfg Config) Validate() error {
	if !loopbackAddress(cfg.Address) {
		return errors.New("AUTH_GATEWAY_ADDR must bind to a loopback address")
	}
	if cfg.DatabaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}
	origin, err := parseOrigin(cfg.PublicOrigin)
	if err != nil {
		return fmt.Errorf("AUTH_PUBLIC_ORIGIN: %w", err)
	}
	issuer, err := parseOrigin(cfg.OIDCIssuer)
	if err != nil {
		return fmt.Errorf("TELEGRAM_OIDC_ISSUER: %w", err)
	}
	if issuer.Scheme != "https" && !(issuer.Scheme == "http" && isLoopbackHost(issuer.Hostname())) {
		return errors.New("TELEGRAM_OIDC_ISSUER must use HTTPS")
	}
	// A custom issuer is useful only for a loopback integration test. Production
	// must never be redirectable to a look-alike identity provider.
	if cfg.OIDCIssuer != TelegramIssuer && !isLoopbackHost(origin.Hostname()) {
		return errors.New("TELEGRAM_OIDC_ISSUER must be https://oauth.telegram.org in production")
	}
	if !validPositiveDecimal(cfg.OIDCClientID, 32) {
		return errors.New("TELEGRAM_OIDC_CLIENT_ID must be a positive decimal Bot ID")
	}
	if len(cfg.OIDCClientSecret) < 16 || len(cfg.OIDCClientSecret) > 1024 || strings.ContainsAny(cfg.OIDCClientSecret, "\r\n\x00") {
		return errors.New("TELEGRAM_OIDC_CLIENT_SECRET must contain 16..1024 safe characters")
	}
	if cfg.BotWebhookEnabled {
		if !validBotToken(cfg.BotToken) {
			return errors.New("TELEGRAM_AUTH_BOT_TOKEN is invalid")
		}
		if !validWebhookSecret(cfg.BotWebhookSecret) {
			return errors.New("TELEGRAM_AUTH_WEBHOOK_SECRET must contain 32..256 safe characters")
		}
	}
	if cfg.MigrationsDir == "" {
		return errors.New("MIGRATIONS_DIR is required")
	}
	if cfg.SessionTTL < time.Hour || cfg.SessionTTL > 90*24*time.Hour {
		return errors.New("AUTH_SESSION_TTL must be between 1h and 2160h")
	}
	if cfg.TransactionTTL < time.Minute || cfg.TransactionTTL > 30*time.Minute {
		return errors.New("AUTH_TRANSACTION_TTL must be between 1m and 30m")
	}
	if cfg.ShutdownTimeout < time.Second || cfg.ShutdownTimeout > time.Minute {
		return errors.New("AUTH_SHUTDOWN_TIMEOUT must be between 1s and 1m")
	}
	if cfg.HTTPTimeout < time.Second || cfg.HTTPTimeout > 10*time.Second {
		return errors.New("AUTH_OIDC_HTTP_TIMEOUT must be between 1s and 10s")
	}
	return nil
}

func validBotToken(value string) bool {
	parts := strings.Split(value, ":")
	if len(parts) != 2 || !validPositiveDecimal(parts[0], 20) || len(parts[1]) < 20 || len(parts[1]) > 128 {
		return false
	}
	for _, character := range parts[1] {
		if !((character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || (character >= '0' && character <= '9') || character == '_' || character == '-') {
			return false
		}
	}
	return true
}

func validPositiveDecimal(value string, maxLength int) bool {
	if value == "" || len(value) > maxLength || value[0] == '0' {
		return false
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

func validWebhookSecret(value string) bool {
	if len(value) < 32 || len(value) > 256 {
		return false
	}
	for _, character := range value {
		if !((character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || (character >= '0' && character <= '9') || character == '_' || character == '-') {
			return false
		}
	}
	return true
}

func (cfg Config) CallbackURL() string { return cfg.PublicOrigin + "/__auth/telegram/callback" }

func parseOrigin(raw string) (*url.URL, error) {
	parsed, err := parseAbsoluteURL(raw)
	if err != nil {
		return nil, err
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path != "" {
		return nil, errors.New("must be an origin without path, query, or fragment")
	}
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && isLoopbackHost(parsed.Hostname())) {
		return nil, errors.New("must use HTTPS (loopback HTTP is allowed for tests)")
	}
	return parsed, nil
}

func parseAbsoluteURL(raw string) (*url.URL, error) {
	parsed, err := url.Parse(raw)
	if err != nil || !parsed.IsAbs() || parsed.User != nil || parsed.Hostname() == "" {
		return nil, errors.New("must be an absolute URL without user information")
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return nil, errors.New("must use HTTP or HTTPS")
	}
	return parsed, nil
}

func loopbackAddress(address string) bool {
	host, _, err := net.SplitHostPort(address)
	return err == nil && isLoopbackHost(host)
}

func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func envOr(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func parseOptionalBool(key string, fallback bool) (bool, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return false, fmt.Errorf("%s must be true or false", key)
	}
	return parsed, nil
}

func parseOptionalDuration(key string, fallback time.Duration) (time.Duration, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return 0, fmt.Errorf("%s must be a valid duration", key)
	}
	return parsed, nil
}
