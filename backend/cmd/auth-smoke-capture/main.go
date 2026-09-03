package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/tencorp/real-estate-platform/backend/internal/authsmokecapture"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) != 1 {
		return errors.New("usage: auth-smoke-capture <base64url-marker>")
	}
	handler, err := authsmokecapture.New(args[0])
	if err != nil {
		return err
	}

	listener, err := net.Listen("tcp", authsmokecapture.ListenAddress)
	if err != nil {
		return errors.New("listen for auth smoke callback")
	}
	server := &http.Server{
		Addr:              authsmokecapture.ListenAddress,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      40 * time.Second,
		IdleTimeout:       15 * time.Second,
		MaxHeaderBytes:    16 << 10,
		ErrorLog:          log.New(io.Discard, "", 0),
	}
	serveError := make(chan error, 1)
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveError <- errors.New("serve auth smoke callback")
		}
	}()

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	select {
	case <-handler.Done():
		return authsmokecapture.Shutdown(server)
	case <-ctx.Done():
		return authsmokecapture.Shutdown(server)
	case err := <-serveError:
		_ = listener.Close()
		return err
	}
}
