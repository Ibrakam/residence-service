package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"sort"
	"strings"
	"syscall"

	"github.com/tencorp/real-estate-platform/backend/internal/catalogsync"
	"github.com/tencorp/real-estate-platform/backend/internal/config"
	"github.com/tencorp/real-estate-platform/backend/internal/database"
)

type providerFlags []string

func (values *providerFlags) String() string {
	return strings.Join(*values, ",")
}

func (values *providerFlags) Set(value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return fmt.Errorf("provider cannot be empty")
	}
	*values = append(*values, value)
	return nil
}

func main() {
	os.Exit(run())
}

func run() int {
	var requested providerFlags
	configPath := flag.String("config", "/etc/residence-catalog-sync/config.json", "provider sync configuration")
	dryRun := flag.Bool("dry-run", false, "capture and validate without importing or changing sync status")
	checkConfig := flag.Bool("check-config", false, "validate configuration without database or provider access")
	migrate := flag.Bool("migrate", false, "apply database migrations before running (normally a release step)")
	flag.Var(&requested, "provider", "run only this provider; may be repeated")
	flag.Parse()

	syncConfig, err := catalogsync.LoadConfig(*configPath)
	if err != nil {
		return fail("configuration_invalid")
	}
	selected, ok := selectProviders(syncConfig, requested)
	if !ok {
		return fail("provider_not_configured")
	}
	if *checkConfig {
		providers := make([]string, 0, len(syncConfig.Providers))
		for _, provider := range syncConfig.Providers {
			providers = append(providers, provider.Name)
		}
		sort.Strings(providers)
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{
			"status": "valid", "providers": providers,
		})
		return 0
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	applicationConfig := config.Load()
	databaseURL, configured := os.LookupEnv("DATABASE_URL")
	if !configured || strings.TrimSpace(databaseURL) == "" {
		return fail("database_configuration_missing")
	}
	pool, err := database.Open(ctx, databaseURL)
	if err != nil {
		return fail("database_unavailable")
	}
	defer pool.Close()
	if *migrate {
		if err := database.Migrate(ctx, pool, applicationConfig.MigrationsDir); err != nil {
			return fail("migration_failed")
		}
	}

	logger := slog.New(slog.NewJSONHandler(os.Stderr, nil))
	results := catalogsync.NewRunner(pool, logger).Run(ctx, syncConfig, selected, *dryRun)
	if err := json.NewEncoder(os.Stdout).Encode(map[string]any{"items": results}); err != nil {
		return fail("result_write_failed")
	}
	for _, result := range results {
		if result.Status == "failed" {
			return 1
		}
	}
	return 0
}

func selectProviders(config catalogsync.Config, requested []string) (map[string]struct{}, bool) {
	if len(requested) == 0 {
		return nil, true
	}
	known := make(map[string]struct{}, len(config.Providers))
	for _, provider := range config.Providers {
		known[provider.Name] = struct{}{}
	}
	selected := make(map[string]struct{}, len(requested))
	for _, provider := range requested {
		if _, ok := known[provider]; !ok {
			return nil, false
		}
		selected[provider] = struct{}{}
	}
	return selected, true
}

func fail(code string) int {
	_ = json.NewEncoder(os.Stderr).Encode(map[string]string{"status": "failed", "errorCode": code})
	return 1
}
