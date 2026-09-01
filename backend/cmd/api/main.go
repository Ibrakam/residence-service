package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/tencorp/real-estate-platform/backend/internal/config"
	"github.com/tencorp/real-estate-platform/backend/internal/database"
	"github.com/tencorp/real-estate-platform/backend/internal/httpapi"
	"github.com/tencorp/real-estate-platform/backend/internal/importer"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("catalog API stopped", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	cfg := config.Load()
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("connect to database: %w", err)
	}
	defer pool.Close()
	if cfg.AutoMigrate {
		if err := database.Migrate(ctx, pool, cfg.MigrationsDir); err != nil {
			return fmt.Errorf("apply migrations: %w", err)
		}
	}
	if cfg.ImportOnStart {
		catalogResult, err := importer.ImportCatalogDirectory(ctx, pool, cfg.CatalogDataDir)
		if err != nil {
			return fmt.Errorf("import versioned catalogs: %w", err)
		}
		logger.Info("versioned catalogs imported", "files", catalogResult.Files, "projects", catalogResult.Projects, "records", catalogResult.RecordsSaved, "partialRecords", catalogResult.PartialRecords)
	}

	handler := httpapi.NewWithOptions(database.NewStore(pool), logger, httpapi.Options{
		AllowedOrigins:      cfg.AllowedOrigin,
		LeadWrites:          cfg.LeadWrites,
		RequestTimeout:      cfg.RequestTimeout,
		LeadDuplicateWindow: cfg.LeadCooldown,
		LeadMaxInFlight:     cfg.LeadMaxInFlight,
	})
	server := &http.Server{
		Addr:              cfg.Address,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    32 << 10,
	}

	serveErr := make(chan error, 1)
	go func() {
		logger.Info("catalog API listening", "address", cfg.Address)
		serveErr <- server.ListenAndServe()
	}()

	select {
	case err := <-serveErr:
		return fmt.Errorf("serve API: %w", err)
	case <-ctx.Done():
		logger.Info("catalog API shutting down")
	}
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer shutdownCancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		_ = server.Close()
		return fmt.Errorf("shutdown API: %w", err)
	}
	return nil
}
