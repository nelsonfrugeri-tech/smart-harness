// Command migrate creates the DynamoDB table and seeds portfolio p-1. Running it again changes nothing.
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/nelsonfrugeri-tech/smart-harness/examples/investimentos-api/internal/dynamo"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "migrate:", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()

	table := getenv("DYNAMODB_TABLE", "investimentos")
	client, err := dynamo.NewClient(ctx, dynamo.Config{
		Endpoint: getenv("DYNAMODB_ENDPOINT", "http://127.0.0.1:8100"),
		Region:   getenv("AWS_REGION", "us-east-1"),
	})
	if err != nil {
		return err
	}

	created, err := dynamo.EnsureTable(ctx, client, table)
	if err != nil {
		return err
	}
	if created {
		fmt.Printf("table %s: created\n", table)
	} else {
		fmt.Printf("table %s: already exists\n", table)
	}

	written, err := dynamo.Seed(ctx, client, table)
	if err != nil {
		return err
	}
	fmt.Printf("seed portfolio %s: %d item(s) written\n", dynamo.SeedPortfolioID, written)
	return nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
