.PHONY: up migrate run test test-integration down

DYNAMODB_PORT ?= 8100
# Always this folder's compose file and project, whatever COMPOSE_FILE says.
COMPOSE := docker compose --file compose.yaml --project-name investimentos-api

# Local-only settings. The fake credentials are set in code when DYNAMODB_ENDPOINT is set.
export DYNAMODB_PORT
export DYNAMODB_ENDPOINT ?= http://127.0.0.1:$(DYNAMODB_PORT)
export DYNAMODB_TABLE ?= investimentos
export AWS_REGION ?= us-east-1
export ADDR ?= 127.0.0.1:8090

## up: starts DynamoDB Local from this folder's compose.yaml and waits for the healthcheck.
up:
	$(COMPOSE) up --detach --wait

## migrate: creates the table and seeds portfolio p-1 (idempotent).
migrate:
	go run ./cmd/migrate

## run: serves the API on $(ADDR) in the foreground.
run:
	go run ./cmd/api

## test: unit tests, no Docker needed.
test:
	go test ./...

## test-integration: tests against DynamoDB Local (needs `make up`); each test uses its own table.
test-integration:
	go test -tags integration -count=1 ./...

## down: stops this example's DynamoDB Local only. Data is in memory and is discarded.
down:
	$(COMPOSE) down
