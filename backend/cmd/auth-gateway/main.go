package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/tencorp/real-estate-platform/backend/internal/database"
	"github.com/tencorp/real-estate-platform/backend/internal/webauth"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("auth gateway stopped", "error", err.Error())
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	cfg, err := webauth.LoadConfig()
	if err != nil {
		return err
	}
	if len(os.Args) == 2 && os.Args[1] == "--config-check" {
		fmt.Fprintln(os.Stdout, "auth gateway configuration is valid")
		return nil
	}
	if len(os.Args) != 1 {
		return errors.New("usage: auth-gateway [--config-check]")
	}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return errors.New("connect auth database")
	}
	defer pool.Close()
	if cfg.AutoMigrate {
		if err := database.Migrate(ctx, pool, cfg.MigrationsDir); err != nil {
			return errors.New("apply auth migrations")
		}
	}
	provider, err := webauth.NewTelegramOIDC(ctx, cfg)
	if err != nil {
		return err
	}
	serverOptions := []webauth.ServerOption{webauth.WithLogger(logger)}
	if cfg.BotWebhookEnabled {
		bot, err := webauth.NewTelegramBot(cfg.BotToken, cfg.HTTPTimeout)
		if err != nil {
			return err
		}
		serverOptions = append(serverOptions, webauth.WithTelegramBot(bot))
	}
	server, err := webauth.NewServer(cfg, webauth.NewStore(pool), provider, serverOptions...)
	if err != nil {
		return err
	}
	httpServer := &http.Server{
		Addr: cfg.Address, Handler: server.Handler(),
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second,
		WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second,
		MaxHeaderBytes: 16 << 10,
	}
	serveError := make(chan error, 1)
	go func() {
		logger.Info("auth gateway listening", "address", cfg.Address, "version", webauth.APIVersion)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveError <- errors.New("serve auth gateway")
		}
	}()
	select {
	case <-ctx.Done():
	case err := <-serveError:
		cancel()
		return err
	}
	shutdownContext, shutdownCancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer shutdownCancel()
	if err := httpServer.Shutdown(shutdownContext); err != nil {
		_ = httpServer.Close()
		return errors.New("shutdown auth gateway")
	}
	return nil
}
