// Command api serves the investimentos HTTP API.
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

	"github.com/nelsonfrugeri-tech/smart-harness/examples/investimentos-api/internal/dynamo"
	"github.com/nelsonfrugeri-tech/smart-harness/examples/investimentos-api/internal/httpapi"
	"github.com/nelsonfrugeri-tech/smart-harness/examples/investimentos-api/internal/investments"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, logger); err != nil {
		logger.Error("api stopped", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, logger *slog.Logger) error {
	addr := getenv("ADDR", "127.0.0.1:8090")
	table := getenv("DYNAMODB_TABLE", "investimentos")
	client, err := dynamo.NewClient(ctx, dynamo.Config{
		Endpoint: getenv("DYNAMODB_ENDPOINT", "http://127.0.0.1:8100"),
		Region:   getenv("AWS_REGION", "us-east-1"),
	})
	if err != nil {
		return err
	}
	service := investments.NewService(dynamo.NewStore(client, table))

	server := &http.Server{
		Addr:              addr,
		Handler:           httpapi.NewHandler(service, logger),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	errCh := make(chan error, 1)
	go func() {
		logger.Info("api listening", "addr", addr, "table", table)
		errCh <- server.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		return fmt.Errorf("listen on %s: %w", addr, err)
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}
	if err := <-errCh; !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("serve: %w", err)
	}
	logger.Info("api stopped")
	return nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
