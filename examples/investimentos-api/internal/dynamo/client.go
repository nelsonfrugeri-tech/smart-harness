package dynamo

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

// Config selects the DynamoDB endpoint and region.
type Config struct {
	// Endpoint is the DynamoDB Local URL, for example http://127.0.0.1:8100.
	// When empty, the client uses the AWS endpoint and the default credential chain.
	Endpoint string
	Region   string
}

// NewClient returns a DynamoDB client. With a local Endpoint it uses the fake
// credentials "local", so no real AWS credential is read or sent.
func NewClient(ctx context.Context, cfg Config) (*dynamodb.Client, error) {
	opts := []func(*config.LoadOptions) error{config.WithRegion(cfg.Region)}
	if cfg.Endpoint != "" {
		opts = append(opts, config.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider("local", "local", ""),
		))
	}
	awsCfg, err := config.LoadDefaultConfig(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("load aws config: %w", err)
	}
	return dynamodb.NewFromConfig(awsCfg, func(o *dynamodb.Options) {
		if cfg.Endpoint != "" {
			o.BaseEndpoint = aws.String(cfg.Endpoint)
			// DynamoDB Local omits the x-amz-crc32 header on error responses, and the SDK
			// would log a checksum warning for each expected error (table exists, condition failed).
			o.DisableValidateResponseChecksum = true
		}
	}), nil
}
