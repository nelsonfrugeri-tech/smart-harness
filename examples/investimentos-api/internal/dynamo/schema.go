package dynamo

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// tableActiveTimeout bounds how long EnsureTable waits for a new table to become ACTIVE.
const tableActiveTimeout = 30 * time.Second

// EnsureTable creates the table and GSI1 when they do not exist and waits until the table is ACTIVE.
// It reports whether the table was created by this call.
func EnsureTable(ctx context.Context, client API, table string) (bool, error) {
	_, err := client.CreateTable(ctx, &dynamodb.CreateTableInput{
		TableName:   aws.String(table),
		BillingMode: types.BillingModePayPerRequest,
		AttributeDefinitions: []types.AttributeDefinition{
			{AttributeName: aws.String(attrPK), AttributeType: types.ScalarAttributeTypeS},
			{AttributeName: aws.String(attrSK), AttributeType: types.ScalarAttributeTypeS},
			{AttributeName: aws.String(attrGSI1PK), AttributeType: types.ScalarAttributeTypeS},
			{AttributeName: aws.String(attrGSI1SK), AttributeType: types.ScalarAttributeTypeS},
		},
		KeySchema: []types.KeySchemaElement{
			{AttributeName: aws.String(attrPK), KeyType: types.KeyTypeHash},
			{AttributeName: aws.String(attrSK), KeyType: types.KeyTypeRange},
		},
		GlobalSecondaryIndexes: []types.GlobalSecondaryIndex{{
			IndexName: aws.String(indexGSI1),
			KeySchema: []types.KeySchemaElement{
				{AttributeName: aws.String(attrGSI1PK), KeyType: types.KeyTypeHash},
				{AttributeName: aws.String(attrGSI1SK), KeyType: types.KeyTypeRange},
			},
			Projection: &types.Projection{ProjectionType: types.ProjectionTypeAll},
		}},
	})
	created := true
	if err != nil {
		var inUse *types.ResourceInUseException
		if !errors.As(err, &inUse) {
			return false, fmt.Errorf("create table %q: %w", table, err)
		}
		created = false
	}
	waiter := dynamodb.NewTableExistsWaiter(client)
	if err := waiter.Wait(ctx, &dynamodb.DescribeTableInput{TableName: aws.String(table)}, tableActiveTimeout); err != nil {
		return false, fmt.Errorf("wait for table %q: %w", table, err)
	}
	return created, nil
}

// SeedPortfolioID is the portfolio created by Seed.
const SeedPortfolioID = "p-1"

// seedItems returns the sample portfolio and its two positions.
func seedItems() []any {
	pk := portfolioPrefix + SeedPortfolioID
	return []any{
		portfolioItem{PK: pk, SK: portfolioSK, Name: "Main portfolio"},
		positionItem{PK: pk, SK: positionPrefix + "PETR4", Symbol: "PETR4", Quantity: 100, AveragePriceCents: 3852},
		positionItem{PK: pk, SK: positionPrefix + "VALE3", Symbol: "VALE3", Quantity: 50, AveragePriceCents: 6120},
	}
}

// Seed writes the sample portfolio p-1 and its positions. Existing items are left untouched,
// so running it again changes nothing. It returns how many items it wrote.
func Seed(ctx context.Context, client API, table string) (int, error) {
	written := 0
	for _, v := range seedItems() {
		item, err := attributevalue.MarshalMap(v)
		if err != nil {
			return written, fmt.Errorf("encode seed item: %w", err)
		}
		_, err = client.PutItem(ctx, &dynamodb.PutItemInput{
			TableName:           aws.String(table),
			Item:                item,
			ConditionExpression: aws.String("attribute_not_exists(PK)"),
		})
		if isConditionFailed(err) {
			continue
		}
		if err != nil {
			return written, fmt.Errorf("put seed item: %w", err)
		}
		written++
	}
	return written, nil
}
