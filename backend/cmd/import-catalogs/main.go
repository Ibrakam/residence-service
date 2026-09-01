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
	dataDir := flag.String("data-dir", cfg.CatalogDataDir, "directory with versioned website catalog snapshots")
	dryRun := flag.Bool("dry-run", false, "validate snapshots and print counts without connecting to PostgreSQL")
	flag.Parse()

	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if *dryRun {
		audit, err := importer.AuditCatalogDirectory(*dataDir)
		if err != nil {
			fatal(err)
		}
		if err := encoder.Encode(audit); err != nil {
			fatal(err)
		}
		return
	}

	ctx := context.Background()
	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		fatal(err)
	}
	defer pool.Close()
	if err := database.Migrate(ctx, pool, cfg.MigrationsDir); err != nil {
		fatal(err)
	}
	result, err := importer.ImportCatalogDirectory(ctx, pool, *dataDir)
	if err != nil {
		fatal(err)
	}
	if err := encoder.Encode(result); err != nil {
		fatal(err)
	}
}

func fatal(err error) {
	_, _ = fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
