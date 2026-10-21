// Package dynamo stores the investments domain in a single DynamoDB table.
//
// Item layout (see docs/adr/ADR-0001-single-table-sem-scan.md):
//
//	entity     PK                SK                GSI1PK         GSI1SK
//	portfolio  PORTFOLIO#<id>    PORTFOLIO         -              -
//	position   PORTFOLIO#<id>    POSITION#<symbol> -              -
//	order      PORTFOLIO#<id>    ORDER#<orderId>   ORDER#<orderId> ORDER
//
// Every read is a GetItem or a Query on a known key. The code never calls Scan.
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

	"github.com/nelsonfrugeri-tech/smart-harness/examples/investimentos-api/internal/investments"
)

// Key attribute and index names.
const (
	attrPK     = "PK"
	attrSK     = "SK"
	attrGSI1PK = "GSI1PK"
	attrGSI1SK = "GSI1SK"
	indexGSI1  = "GSI1"
)

// Key prefixes and fixed sort keys.
const (
	portfolioPrefix = "PORTFOLIO#"
	portfolioSK     = "PORTFOLIO"
	positionPrefix  = "POSITION#"
	orderPrefix     = "ORDER#"
	orderGSI1SK     = "ORDER"
)

// API is the subset of the DynamoDB client used by this package.
type API interface {
	GetItem(ctx context.Context, in *dynamodb.GetItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
	PutItem(ctx context.Context, in *dynamodb.PutItemInput, optFns ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error)
	Query(ctx context.Context, in *dynamodb.QueryInput, optFns ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error)
	CreateTable(ctx context.Context, in *dynamodb.CreateTableInput, optFns ...func(*dynamodb.Options)) (*dynamodb.CreateTableOutput, error)
	DescribeTable(ctx context.Context, in *dynamodb.DescribeTableInput, optFns ...func(*dynamodb.Options)) (*dynamodb.DescribeTableOutput, error)
}

// Store implements investments.Store on one DynamoDB table.
type Store struct {
	client API
	table  string
}

// NewStore returns a Store that reads and writes the given table.
func NewStore(client API, table string) *Store {
	return &Store{client: client, table: table}
}

type portfolioItem struct {
	PK   string `dynamodbav:"PK"`
	SK   string `dynamodbav:"SK"`
	Name string `dynamodbav:"name"`
}

type positionItem struct {
	PK                string `dynamodbav:"PK"`
	SK                string `dynamodbav:"SK"`
	Symbol            string `dynamodbav:"symbol"`
	Quantity          int64  `dynamodbav:"quantity"`
	AveragePriceCents int64  `dynamodbav:"average_price_cents"`
}

type orderItem struct {
	PK          string `dynamodbav:"PK"`
	SK          string `dynamodbav:"SK"`
	GSI1PK      string `dynamodbav:"GSI1PK"`
	GSI1SK      string `dynamodbav:"GSI1SK"`
	OrderID     string `dynamodbav:"order_id"`
	PortfolioID string `dynamodbav:"portfolio_id"`
	Symbol      string `dynamodbav:"symbol"`
	Side        string `dynamodbav:"side"`
	Quantity    int64  `dynamodbav:"quantity"`
	PriceCents  int64  `dynamodbav:"price_cents"`
	Status      string `dynamodbav:"status"`
	CreatedAt   string `dynamodbav:"created_at"`
}

func portfolioKey(portfolioID string) map[string]types.AttributeValue {
	return map[string]types.AttributeValue{
		attrPK: &types.AttributeValueMemberS{Value: portfolioPrefix + portfolioID},
		attrSK: &types.AttributeValueMemberS{Value: portfolioSK},
	}
}

// PortfolioExists reads the portfolio item by its key.
func (s *Store) PortfolioExists(ctx context.Context, portfolioID string) (bool, error) {
	out, err := s.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:            aws.String(s.table),
		Key:                  portfolioKey(portfolioID),
		ProjectionExpression: aws.String(attrPK),
	})
	if err != nil {
		return false, fmt.Errorf("get portfolio item: %w", err)
	}
	return out.Item != nil, nil
}

// ListPositions queries the POSITION# items of the portfolio partition.
// It follows DynamoDB pages until the end, because the HTTP API does not paginate yet (BL-102).
func (s *Store) ListPositions(ctx context.Context, portfolioID string) ([]investments.Position, error) {
	exists, err := s.PortfolioExists(ctx, portfolioID)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, investments.ErrPortfolioNotFound
	}

	paginator := dynamodb.NewQueryPaginator(s.client, &dynamodb.QueryInput{
		TableName:              aws.String(s.table),
		KeyConditionExpression: aws.String("PK = :pk AND begins_with(SK, :prefix)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk":     &types.AttributeValueMemberS{Value: portfolioPrefix + portfolioID},
			":prefix": &types.AttributeValueMemberS{Value: positionPrefix},
		},
	})
	positions := []investments.Position{}
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("query positions: %w", err)
		}
		var items []positionItem
		if err := attributevalue.UnmarshalListOfMaps(page.Items, &items); err != nil {
			return nil, fmt.Errorf("decode positions: %w", err)
		}
		for _, it := range items {
			positions = append(positions, investments.Position{
				Symbol:            it.Symbol,
				Quantity:          it.Quantity,
				AveragePriceCents: it.AveragePriceCents,
			})
		}
	}
	return positions, nil
}

// CreateOrder writes the order in the portfolio partition and indexes it by ID in GSI1.
func (s *Store) CreateOrder(ctx context.Context, order investments.Order) error {
	item, err := attributevalue.MarshalMap(orderItem{
		PK:          portfolioPrefix + order.PortfolioID,
		SK:          orderPrefix + order.ID,
		GSI1PK:      orderPrefix + order.ID,
		GSI1SK:      orderGSI1SK,
		OrderID:     order.ID,
		PortfolioID: order.PortfolioID,
		Symbol:      order.Symbol,
		Side:        string(order.Side),
		Quantity:    order.Quantity,
		PriceCents:  order.PriceCents,
		Status:      string(order.Status),
		CreatedAt:   order.CreatedAt.UTC().Format(time.RFC3339),
	})
	if err != nil {
		return fmt.Errorf("encode order: %w", err)
	}
	_, err = s.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName:           aws.String(s.table),
		Item:                item,
		ConditionExpression: aws.String("attribute_not_exists(PK)"),
	})
	if err != nil {
		return fmt.Errorf("put order item: %w", err)
	}
	return nil
}

// GetOrder queries GSI1 by order ID. GSI reads are eventually consistent on AWS.
func (s *Store) GetOrder(ctx context.Context, orderID string) (investments.Order, error) {
	out, err := s.client.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(s.table),
		IndexName:              aws.String(indexGSI1),
		KeyConditionExpression: aws.String("GSI1PK = :pk AND GSI1SK = :sk"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk": &types.AttributeValueMemberS{Value: orderPrefix + orderID},
			":sk": &types.AttributeValueMemberS{Value: orderGSI1SK},
		},
		Limit: aws.Int32(1),
	})
	if err != nil {
		return investments.Order{}, fmt.Errorf("query order: %w", err)
	}
	if len(out.Items) == 0 {
		return investments.Order{}, investments.ErrOrderNotFound
	}
	var it orderItem
	if err := attributevalue.UnmarshalMap(out.Items[0], &it); err != nil {
		return investments.Order{}, fmt.Errorf("decode order: %w", err)
	}
	createdAt, err := time.Parse(time.RFC3339, it.CreatedAt)
	if err != nil {
		return investments.Order{}, fmt.Errorf("decode order created_at: %w", err)
	}
	return investments.Order{
		ID:          it.OrderID,
		PortfolioID: it.PortfolioID,
		Symbol:      it.Symbol,
		Side:        investments.Side(it.Side),
		Quantity:    it.Quantity,
		PriceCents:  it.PriceCents,
		Status:      investments.OrderStatus(it.Status),
		CreatedAt:   createdAt,
	}, nil
}

// isConditionFailed reports whether err is a failed ConditionExpression.
func isConditionFailed(err error) bool {
	var ccf *types.ConditionalCheckFailedException
	return errors.As(err, &ccf)
}
