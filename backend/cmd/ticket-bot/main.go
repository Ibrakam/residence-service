package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/tencorp/real-estate-platform/backend/internal/database"
	"github.com/tencorp/real-estate-platform/backend/internal/tickets"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	var err error
	if len(os.Args) > 1 && os.Args[1] == "enqueue-test" {
		err = enqueueTest(os.Args[2:], os.Stdin, os.Stdout)
	} else if len(os.Args) > 1 && os.Args[1] == "cleanup-attachments" {
		err = cleanupAttachments(os.Args[2:], os.Stdout, logger)
	} else {
		err = run(logger)
	}
	if err != nil {
		logger.Error("ticket bot stopped", "error", safeError(err))
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	cfg, err := tickets.LoadConfig()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(cfg.AttachmentDir, 0o700); err != nil {
		return errors.New("create ticket attachment directory")
	}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return errors.New("connect ticket database")
	}
	defer pool.Close()
	if cfg.AutoMigrate {
		if err := database.Migrate(ctx, pool, cfg.MigrationsDir); err != nil {
			return errors.New("apply ticket migrations")
		}
	}
	store := tickets.NewStore(pool)
	telegram := tickets.NewTelegramClient(cfg.TelegramToken, cfg.LongPollTimeout+15*time.Second)
	reporter := tickets.NewReporter(store, telegram)
	service := tickets.NewService(cfg, store, telegram, reporter, logger)
	workerServer, err := tickets.NewWorkerServer(cfg, store)
	if err != nil {
		return err
	}
	httpServer := &http.Server{
		Addr: cfg.Address, Handler: workerServer.Handler(),
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second,
		WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second,
		MaxHeaderBytes: 16 << 10,
	}
	serveErrors := make(chan error, 2)
	go func() {
		logger.Info("ticket worker API listening", "address", cfg.Address, "version", tickets.RunnerAPIVersion)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErrors <- errors.New("serve ticket worker API")
		}
	}()
	go func() {
		if err := service.Run(ctx); err != nil {
			serveErrors <- errors.New("run Telegram ticket intake")
		}
	}()
	select {
	case <-ctx.Done():
	case err := <-serveErrors:
		cancel()
		return err
	}
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer shutdownCancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		_ = httpServer.Close()
		return errors.New("shutdown ticket worker API")
	}
	return nil
}

func enqueueTest(arguments []string, stdin io.Reader, stdout io.Writer) error {
	flags := flag.NewFlagSet("enqueue-test", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	textFlag := flags.String("text", "", "synthetic ticket text; stdin is used when omitted")
	timeout := flags.Duration("timeout", 10*time.Second, "request timeout")
	if err := flags.Parse(arguments); err != nil {
		return errors.New("invalid enqueue-test arguments")
	}
	if flags.NArg() != 0 || *timeout < time.Second || *timeout > time.Minute {
		return errors.New("invalid enqueue-test arguments")
	}
	text := strings.TrimSpace(*textFlag)
	if text == "" {
		body, err := io.ReadAll(io.LimitReader(stdin, 12001))
		if err != nil {
			return errors.New("read test ticket text")
		}
		if len(body) > 12000 {
			return errors.New("test ticket text is too long")
		}
		text = strings.TrimSpace(string(body))
	}
	if text == "" {
		return errors.New("test ticket text is required")
	}
	address := strings.TrimSpace(os.Getenv("TICKET_BOT_ADDR"))
	if address == "" {
		address = "127.0.0.1:8090"
	}
	if !isLoopbackAddress(address) {
		return errors.New("TICKET_BOT_ADDR must bind to loopback")
	}
	token := strings.TrimSpace(os.Getenv("TICKET_WORKER_API_TOKEN"))
	if len(token) < 32 {
		return errors.New("TICKET_WORKER_API_TOKEN must contain at least 32 characters")
	}
	payload, _ := json.Marshal(map[string]string{"text": text})
	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"http://"+address+"/internal/ticket-runner/test-tickets", bytes.NewReader(payload))
	if err != nil {
		return errors.New("create enqueue-test request")
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return errors.New("enqueue-test request failed")
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 16<<10))
	if err != nil {
		return errors.New("read enqueue-test response")
	}
	if response.StatusCode != http.StatusCreated {
		return fmt.Errorf("enqueue-test returned status %d", response.StatusCode)
	}
	if !json.Valid(responseBody) {
		return errors.New("enqueue-test returned invalid JSON")
	}
	_, err = stdout.Write(responseBody)
	return err
}

func isLoopbackAddress(address string) bool {
	cfg := tickets.Config{
		Address: address, DatabaseURL: "validation", TelegramToken: "validation",
		TelegramChatID: -1, WorkerAPIToken: strings.Repeat("x", 32),
		TelegramAllowedUserIDs: tickets.TelegramUserIDSet{1: {}},
		PublicWorkerBaseURL:    "http://127.0.0.1/", AttachmentDir: "/tmp/ticket-validation",
		Consumer: "validation", LongPollTimeout: time.Second, MediaGroupDelay: time.Second,
		WorkerLeaseTTL: 30 * time.Second, ShutdownTimeout: time.Second, MaxAttachmentBytes: 1,
		AttachmentRetention: 24 * time.Hour, AttachmentDiskWarnBytes: 1 << 20,
	}
	return cfg.Validate() == nil
}

func safeError(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
