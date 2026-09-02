package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"log/slog"
	"time"

	"github.com/tencorp/real-estate-platform/backend/internal/database"
	"github.com/tencorp/real-estate-platform/backend/internal/tickets"
)

func cleanupAttachments(arguments []string, stdout io.Writer, logger *slog.Logger) error {
	flags := flag.NewFlagSet("cleanup-attachments", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	dryRun := flags.Bool("dry-run", false, "report eligible attachments without deleting files or changing database state")
	batchSize := flags.Int("batch-size", 250, "number of eligible attachments processed per batch")
	timeout := flags.Duration("timeout", 15*time.Minute, "maximum cleanup runtime")
	if err := flags.Parse(arguments); err != nil || flags.NArg() != 0 {
		return errors.New("invalid cleanup-attachments arguments")
	}
	if *batchSize < 1 || *batchSize > 2000 || *timeout < time.Second || *timeout > time.Hour {
		return errors.New("invalid cleanup-attachments limits")
	}
	cfg, err := tickets.LoadConfig()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return errors.New("connect ticket database for attachment cleanup")
	}
	defer pool.Close()
	stats, err := tickets.CleanupTerminalAttachments(ctx, cfg, tickets.NewStore(pool), *dryRun, *batchSize, logger)
	if err != nil {
		return err
	}
	return json.NewEncoder(stdout).Encode(stats)
}
