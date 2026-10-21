//go:build integration

package dynamo

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/nelsonfrugeri-tech/smart-harness/examples/investimentos-api/internal/investments"
)

// newTestTable creates a table with a unique name on DynamoDB Local and deletes it after the test.
// It never touches the "investimentos" table used by `make run`.
func newTestTable(t *testing.T) (*dynamodb.Client, string) {
	t.Helper()
	ctx := context.Background()
	endpoint := os.Getenv("DYNAMODB_ENDPOINT")
	if endpoint == "" {
		endpoint = "http://127.0.0.1:8100"
	}
	client, err := NewClient(ctx, Config{Endpoint: endpoint, Region: "us-east-1"})
	if err != nil {
		t.Fatal(err)
	}
	suffix := make([]byte, 4)
	if _, err := rand.Read(suffix); err != nil {
		t.Fatal(err)
	}
	table := "investimentos-it-" + hex.EncodeToString(suffix)

	created, err := EnsureTable(ctx, client, table)
	if err != nil {
		t.Fatalf("EnsureTable on %s (is `make up` running?): %v", endpoint, err)
	}
	if !created {
		t.Fatalf("table %s already existed", table)
	}
	t.Cleanup(func() {
		if _, err := client.DeleteTable(context.Background(), &dynamodb.DeleteTableInput{TableName: aws.String(table)}); err != nil {
			t.Errorf("delete test table %s: %v", table, err)
		}
	})
	return client, table
}

func TestEnsureTableAndSeedAreIdempotent(t *testing.T) {
	ctx := context.Background()
	client, table := newTestTable(t)

	created, err := EnsureTable(ctx, client, table)
	if err != nil || created {
		t.Fatalf("second EnsureTable = (%v, %v), want (false, nil)", created, err)
	}
	for run, want := range []int{3, 0} {
		written, err := Seed(ctx, client, table)
		if err != nil {
			t.Fatalf("Seed run %d: %v", run+1, err)
		}
		if written != want {
			t.Errorf("Seed run %d wrote %d items, want %d", run+1, written, want)
		}
	}
	out, err := client.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(table),
		KeyConditionExpression: aws.String("PK = :pk"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk": &types.AttributeValueMemberS{Value: portfolioPrefix + SeedPortfolioID},
		},
		Select: types.SelectCount,
	})
	if err != nil {
		t.Fatal(err)
	}
	if out.Count != 3 {
		t.Errorf("portfolio partition has %d items after two seeds, want 3", out.Count)
	}
}

func TestStorePositions(t *testing.T) {
	ctx := context.Background()
	client, table := newTestTable(t)
	if _, err := Seed(ctx, client, table); err != nil {
		t.Fatal(err)
	}
	store := NewStore(client, table)

	got, err := store.ListPositions(ctx, SeedPortfolioID)
	if err != nil {
		t.Fatal(err)
	}
	want := []investments.Position{
		{Symbol: "PETR4", Quantity: 100, AveragePriceCents: 3852},
		{Symbol: "VALE3", Quantity: 50, AveragePriceCents: 6120},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("ListPositions = %+v, want %+v", got, want)
	}

	if _, err := store.ListPositions(ctx, "p-missing"); !errors.Is(err, investments.ErrPortfolioNotFound) {
		t.Errorf("ListPositions(p-missing) error = %v, want ErrPortfolioNotFound", err)
	}
}

func TestStoreOrders(t *testing.T) {
	ctx := context.Background()
	client, table := newTestTable(t)
	if _, err := Seed(ctx, client, table); err != nil {
		t.Fatal(err)
	}
	store := NewStore(client, table)
	order := investments.Order{
		ID: "o-it-1", PortfolioID: SeedPortfolioID, Symbol: "PETR4", Side: investments.SideBuy,
		Quantity: 10, PriceCents: 3850, Status: investments.StatusPending,
		CreatedAt: time.Date(2026, 10, 21, 15, 0, 0, 0, time.UTC),
	}

	if err := store.CreateOrder(ctx, order); err != nil {
		t.Fatal(err)
	}
	got, err := store.GetOrder(ctx, order.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got != order {
		t.Errorf("GetOrder = %+v, want %+v", got, order)
	}

	if err := store.CreateOrder(ctx, order); err == nil {
		t.Error("CreateOrder with an existing ID succeeded, want a conditional check error")
	}
	if _, err := store.GetOrder(ctx, "o-missing"); !errors.Is(err, investments.ErrOrderNotFound) {
		t.Errorf("GetOrder(o-missing) error = %v, want ErrOrderNotFound", err)
	}

	positions, err := store.ListPositions(ctx, SeedPortfolioID)
	if err != nil {
		t.Fatal(err)
	}
	if len(positions) != 2 {
		t.Errorf("orders leaked into positions: %+v", positions)
	}
}
