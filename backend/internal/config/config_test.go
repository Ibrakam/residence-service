package config

import (
	"testing"
	"time"
)

func TestLoadAllowsExplicitlyDisablingCORS(t *testing.T) {
	t.Setenv("ALLOWED_ORIGIN", "")

	cfg := Load()
	if cfg.AllowedOrigin != "" {
		t.Fatalf("explicit empty ALLOWED_ORIGIN = %q, want disabled", cfg.AllowedOrigin)
	}
}

func TestLoadProductionSafetyDefaults(t *testing.T) {
	t.Setenv("AUTO_MIGRATE", "typo")
	t.Setenv("REQUEST_TIMEOUT", "not-a-duration")
	t.Setenv("SHUTDOWN_TIMEOUT", "-1s")
	t.Setenv("LEAD_DUPLICATE_WINDOW", "bad")
	t.Setenv("LEAD_MAX_IN_FLIGHT", "0")

	cfg := Load()
	if cfg.AutoMigrate {
		t.Fatal("invalid AUTO_MIGRATE unexpectedly enabled migrations")
	}
	if cfg.RequestTimeout != 10*time.Second {
		t.Fatalf("request timeout = %s", cfg.RequestTimeout)
	}
	if cfg.ShutdownTimeout != 10*time.Second {
		t.Fatalf("shutdown timeout = %s", cfg.ShutdownTimeout)
	}
	if cfg.LeadCooldown != time.Minute {
		t.Fatalf("lead cooldown = %s", cfg.LeadCooldown)
	}
	if cfg.LeadMaxInFlight != 8 {
		t.Fatalf("lead max in flight = %d", cfg.LeadMaxInFlight)
	}
}

func TestLoadRejectsUnboundedLeadConcurrency(t *testing.T) {
	t.Setenv("LEAD_MAX_IN_FLIGHT", "1000000000")
	if got := Load().LeadMaxInFlight; got != 8 {
		t.Fatalf("unbounded lead concurrency = %d", got)
	}
}

func TestLoadAcceptsExplicitLeadControls(t *testing.T) {
	t.Setenv("REQUEST_TIMEOUT", "7s")
	t.Setenv("SHUTDOWN_TIMEOUT", "20s")
	t.Setenv("LEAD_DUPLICATE_WINDOW", "0s")
	t.Setenv("LEAD_MAX_IN_FLIGHT", "12")

	cfg := Load()
	if cfg.RequestTimeout != 7*time.Second || cfg.ShutdownTimeout != 20*time.Second {
		t.Fatalf("unexpected server durations: request=%s shutdown=%s", cfg.RequestTimeout, cfg.ShutdownTimeout)
	}
	if cfg.LeadCooldown != 0 {
		t.Fatalf("lead cooldown = %s, want disabled", cfg.LeadCooldown)
	}
	if cfg.LeadMaxInFlight != 12 {
		t.Fatalf("lead max in flight = %d", cfg.LeadMaxInFlight)
	}
}
