package tickets

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Address                 string
	DatabaseURL             string
	MigrationsDir           string
	AutoMigrate             bool
	TelegramToken           string
	TelegramChatID          int64
	TelegramAllowedUserIDs  TelegramUserIDSet
	Consumer                string
	WorkerAPIToken          string
	PublicWorkerBaseURL     string
	AttachmentDir           string
	LongPollTimeout         time.Duration
	MediaGroupDelay         time.Duration
	WorkerLeaseTTL          time.Duration
	ShutdownTimeout         time.Duration
	MaxAttachmentBytes      int64
	AttachmentRetention     time.Duration
	AttachmentDiskWarnBytes int64
}

func LoadConfig() (Config, error) {
	chatID, err := parseRequiredInt64("TELEGRAM_CHAT_ID")
	if err != nil {
		return Config{}, err
	}
	allowedUserIDs, err := parseTelegramUserIDSet("TELEGRAM_ALLOWED_USER_IDS")
	if err != nil {
		return Config{}, err
	}
	attachmentDir, err := filepath.Abs(getenv("TICKET_ATTACHMENT_DIR", "./data/tickets/attachments"))
	if err != nil {
		return Config{}, errors.New("resolve TICKET_ATTACHMENT_DIR")
	}
	attachmentRetention, err := parseOptionalDuration("TICKET_ATTACHMENT_RETENTION", 30*24*time.Hour)
	if err != nil {
		return Config{}, err
	}
	attachmentDiskWarnBytes, err := parseOptionalPositiveInt64("TICKET_ATTACHMENT_DISK_WARN_BYTES", 5<<30)
	if err != nil {
		return Config{}, err
	}
	cfg := Config{
		Address:                 getenv("TICKET_BOT_ADDR", "127.0.0.1:8090"),
		DatabaseURL:             strings.TrimSpace(os.Getenv("DATABASE_URL")),
		MigrationsDir:           getenv("MIGRATIONS_DIR", "./migrations"),
		AutoMigrate:             parseBool("TICKET_AUTO_MIGRATE", false),
		TelegramToken:           strings.TrimSpace(os.Getenv("TELEGRAM_BOT_TOKEN")),
		TelegramChatID:          chatID,
		TelegramAllowedUserIDs:  allowedUserIDs,
		Consumer:                getenv("TICKET_BOT_CONSUMER", fmt.Sprintf("telegram-chat-%d", chatID)),
		WorkerAPIToken:          strings.TrimSpace(os.Getenv("TICKET_WORKER_API_TOKEN")),
		PublicWorkerBaseURL:     getenv("TICKET_PUBLIC_WORKER_BASE_URL", "http://127.0.0.1:8090/"),
		AttachmentDir:           attachmentDir,
		LongPollTimeout:         parseDuration("TICKET_LONG_POLL_TIMEOUT", 25*time.Second),
		MediaGroupDelay:         parseDuration("TICKET_MEDIA_GROUP_DELAY", 2*time.Second),
		WorkerLeaseTTL:          parseDuration("TICKET_WORKER_LEASE_TTL", 2*time.Minute),
		ShutdownTimeout:         parseDuration("TICKET_SHUTDOWN_TIMEOUT", 15*time.Second),
		MaxAttachmentBytes:      parsePositiveInt64("TICKET_MAX_ATTACHMENT_BYTES", 20<<20),
		AttachmentRetention:     attachmentRetention,
		AttachmentDiskWarnBytes: attachmentDiskWarnBytes,
	}
	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (cfg Config) Validate() error {
	if cfg.DatabaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}
	if cfg.TelegramToken == "" {
		return errors.New("TELEGRAM_BOT_TOKEN is required")
	}
	if cfg.TelegramChatID == 0 {
		return errors.New("TELEGRAM_CHAT_ID must be non-zero")
	}
	if len(cfg.TelegramAllowedUserIDs) == 0 {
		return errors.New("TELEGRAM_ALLOWED_USER_IDS must contain at least one Telegram user ID")
	}
	for userID := range cfg.TelegramAllowedUserIDs {
		if userID <= 0 {
			return errors.New("TELEGRAM_ALLOWED_USER_IDS must contain only positive Telegram user IDs")
		}
	}
	if len(cfg.WorkerAPIToken) < 32 {
		return errors.New("TICKET_WORKER_API_TOKEN must contain at least 32 characters")
	}
	publicURL, err := url.Parse(cfg.PublicWorkerBaseURL)
	if err != nil || !publicURL.IsAbs() || publicURL.RawQuery != "" || publicURL.Fragment != "" {
		return errors.New("TICKET_PUBLIC_WORKER_BASE_URL must be an absolute URL without query or fragment")
	}
	if publicURL.Scheme != "https" && !(publicURL.Scheme == "http" && isLoopbackHost(publicURL.Hostname())) {
		return errors.New("TICKET_PUBLIC_WORKER_BASE_URL must use HTTPS or loopback HTTP")
	}
	if cfg.Consumer == "" || len(cfg.Consumer) > 255 {
		return errors.New("TICKET_BOT_CONSUMER must contain 1..255 characters")
	}
	if cfg.AttachmentDir == "" {
		return errors.New("TICKET_ATTACHMENT_DIR is required")
	}
	if cfg.LongPollTimeout < time.Second || cfg.LongPollTimeout > 50*time.Second {
		return errors.New("TICKET_LONG_POLL_TIMEOUT must be between 1s and 50s")
	}
	if cfg.MediaGroupDelay < 500*time.Millisecond || cfg.MediaGroupDelay > 30*time.Second {
		return errors.New("TICKET_MEDIA_GROUP_DELAY must be between 500ms and 30s")
	}
	if cfg.WorkerLeaseTTL < 30*time.Second || cfg.WorkerLeaseTTL > 15*time.Minute {
		return errors.New("TICKET_WORKER_LEASE_TTL must be between 30s and 15m")
	}
	if cfg.ShutdownTimeout < time.Second || cfg.ShutdownTimeout > time.Minute {
		return errors.New("TICKET_SHUTDOWN_TIMEOUT must be between 1s and 1m")
	}
	if cfg.MaxAttachmentBytes <= 0 || cfg.MaxAttachmentBytes > 2<<30 {
		return errors.New("TICKET_MAX_ATTACHMENT_BYTES must be between 1 and 2147483648")
	}
	if cfg.AttachmentRetention < 24*time.Hour || cfg.AttachmentRetention > 5*365*24*time.Hour {
		return errors.New("TICKET_ATTACHMENT_RETENTION must be between 24h and 43800h")
	}
	if cfg.AttachmentDiskWarnBytes < 1<<20 {
		return errors.New("TICKET_ATTACHMENT_DISK_WARN_BYTES must be at least 1048576")
	}
	if !isLoopbackAddress(cfg.Address) {
		return errors.New("TICKET_BOT_ADDR must bind to loopback")
	}
	return nil
}

func isLoopbackAddress(address string) bool {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return false
	}
	return isLoopbackHost(host)
}

func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func parseRequiredInt64(key string) (int64, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return 0, fmt.Errorf("%s is required", key)
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed == 0 {
		return 0, fmt.Errorf("%s must be a non-zero integer", key)
	}
	return parsed, nil
}

type TelegramUserIDSet map[int64]struct{}

func parseTelegramUserIDSet(key string) (TelegramUserIDSet, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return nil, fmt.Errorf("%s is required", key)
	}
	result := make(TelegramUserIDSet)
	for _, raw := range strings.Split(value, ",") {
		item := strings.TrimSpace(raw)
		if item == "" || !containsOnlyASCIIDigits(item) {
			return nil, fmt.Errorf("%s must be a comma-separated list of positive integer Telegram user IDs", key)
		}
		userID, err := strconv.ParseInt(item, 10, 64)
		if err != nil || userID <= 0 {
			return nil, fmt.Errorf("%s must be a comma-separated list of positive integer Telegram user IDs", key)
		}
		if _, duplicate := result[userID]; duplicate {
			return nil, fmt.Errorf("%s must not contain duplicate Telegram user IDs", key)
		}
		result[userID] = struct{}{}
	}
	return result, nil
}

func containsOnlyASCIIDigits(value string) bool {
	if value == "" {
		return false
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

func parseBool(key string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func parseDuration(key string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}
	return parsed
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

func parseOptionalPositiveInt64(key string, fallback int64) (int64, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer", key)
	}
	return parsed, nil
}

func parsePositiveInt64(key string, fallback int64) int64 {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func getenv(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
