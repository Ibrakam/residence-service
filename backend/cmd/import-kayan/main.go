package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/tencorp/real-estate-platform/backend/internal/config"
	"github.com/tencorp/real-estate-platform/backend/internal/database"
	"github.com/tencorp/real-estate-platform/backend/internal/importer"
)

func main() {
	cfg := config.Load()
	dataDir := flag.String("data-dir", cfg.KayanRawDataDir, "directory with KAYAN JSON snapshots")
	flag.Parse()

	ctx := context.Background()
	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		fatal(err)
	}
	defer pool.Close()
	if err := database.Migrate(ctx, pool, cfg.MigrationsDir); err != nil {
		fatal(err)
	}
	result, err := importer.ImportDirectory(ctx, pool, *dataDir)
	if err != nil {
		fatal(err)
	}
	_ = json.NewEncoder(os.Stdout).Encode(result)
}

func fatal(err error) {
	_, _ = fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
