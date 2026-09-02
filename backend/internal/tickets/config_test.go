package tickets

import (
	"strings"
	"testing"
	"time"
)

func validConfig() Config {
	return Config{
		Address: "127.0.0.1:8090", DatabaseURL: "postgres://local", MigrationsDir: "./migrations",
		TelegramToken: "test-token", TelegramChatID: -123, Consumer: "test-consumer",
		TelegramAllowedUserIDs: TelegramUserIDSet{5: {}},
		WorkerAPIToken:         strings.Repeat("w", 32), AttachmentDir: "/tmp/ticket-test",
		PublicWorkerBaseURL: "https://example.test/__residence-ticket-worker/",
		LongPollTimeout:     time.Second, MediaGroupDelay: time.Second,
		WorkerLeaseTTL: 30 * time.Second, ShutdownTimeout: time.Second,
		MaxAttachmentBytes: 1024, AttachmentRetention: 30 * 24 * time.Hour,
		AttachmentDiskWarnBytes: 1 << 20,
	}
}

func TestLoadConfigRejectsUnsafeAttachmentRetentionSettings(t *testing.T) {
	for key, value := range map[string]string{
		"DATABASE_URL": "postgres://local", "TELEGRAM_BOT_TOKEN": "test-token",
		"TELEGRAM_CHAT_ID": "-123", "TELEGRAM_ALLOWED_USER_IDS": "5",
		"TICKET_WORKER_API_TOKEN": strings.Repeat("w", 32),
	} {
		t.Setenv(key, value)
	}
	for key, value := range map[string]string{
		"TICKET_ATTACHMENT_RETENTION":       "not-a-duration",
		"TICKET_ATTACHMENT_DISK_WARN_BYTES": "zero",
	} {
		t.Run(key, func(t *testing.T) {
			t.Setenv(key, value)
			if _, err := LoadConfig(); err == nil || !strings.Contains(err.Error(), key) {
				t.Fatalf("%s=%q error = %v", key, value, err)
			}
		})
	}
}

func TestLoadConfigRequiresExactUniqueTelegramUserAllowlist(t *testing.T) {
	baseEnvironment := map[string]string{
		"DATABASE_URL": "postgres://local", "TELEGRAM_BOT_TOKEN": "test-token",
		"TELEGRAM_CHAT_ID": "-123", "TICKET_WORKER_API_TOKEN": strings.Repeat("w", 32),
	}
	for key, value := range baseEnvironment {
		t.Setenv(key, value)
	}

	for _, invalid := range []string{"", "5,", "5,,7", "5,5", "-5", "+5", "user", "9223372036854775808"} {
		t.Run("invalid_"+strings.ReplaceAll(invalid, ",", "_"), func(t *testing.T) {
			t.Setenv("TELEGRAM_ALLOWED_USER_IDS", invalid)
			if _, err := LoadConfig(); err == nil || !strings.Contains(err.Error(), "TELEGRAM_ALLOWED_USER_IDS") {
				t.Fatalf("allowlist %q validation error = %v", invalid, err)
			}
		})
	}

	t.Setenv("TELEGRAM_ALLOWED_USER_IDS", "5, 7")
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.TelegramAllowedUserIDs) != 2 {
		t.Fatalf("allowed users = %#v", cfg.TelegramAllowedUserIDs)
	}
	for _, userID := range []int64{5, 7} {
		if _, ok := cfg.TelegramAllowedUserIDs[userID]; !ok {
			t.Fatalf("missing allowed user %d", userID)
		}
	}
}

func TestConfigRequiresLoopbackWorkerListener(t *testing.T) {
	cfg := validConfig()
	cfg.Address = "0.0.0.0:8090"
	if err := cfg.Validate(); err == nil || !strings.Contains(err.Error(), "loopback") {
		t.Fatalf("public bind validation error = %v", err)
	}
	cfg.Address = "[::1]:8090"
	if err := cfg.Validate(); err != nil {
		t.Fatalf("IPv6 loopback rejected: %v", err)
	}
}

func TestConfigRequiresStaticHTTPSPublicWorkerURL(t *testing.T) {
	cfg := validConfig()
	cfg.PublicWorkerBaseURL = "http://public.example/internal"
	if err := cfg.Validate(); err == nil {
		t.Fatal("public HTTP worker URL accepted")
	}
	cfg.PublicWorkerBaseURL = "https://example.test/prefix/?secret=query"
	if err := cfg.Validate(); err == nil {
		t.Fatal("worker URL with query accepted")
	}
}
