.PHONY: check check-go check-node check-examples up down seed

NODE_COMPONENTS := control-plane agent-gateway front
EXAMPLES := examples/investimentos-api

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
COMMIT ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)
LDFLAGS := -X main.version=$(VERSION) -X main.commit=$(COMMIT)

## check: CLI formatting, vet, tests and build; API/gateway checks; frontend contract, format, lint, tests and build; example unit tests.
check: check-go check-node check-examples

check-go:
	@files="$$(gofmt -l cli)"; if [ -n "$$files" ]; then echo "gofmt: unformatted files:"; echo "$$files"; exit 1; fi
	go -C cli vet ./...
	go -C cli test ./...
	go -C cli build -ldflags "$(LDFLAGS)" -o bin/harness ./cmd/harness

check-node: $(addsuffix /node_modules,$(NODE_COMPONENTS))
	@for c in $(NODE_COMPONENTS); do echo "== $$c"; (cd $$c && npm run --silent check) || exit 1; done

## check-examples: unit tests of each example (no Docker; DynamoDB Local integration tests stay out).
check-examples:
	@for e in $(EXAMPLES); do echo "== $$e"; $(MAKE) -C $$e test || exit 1; done

# Reinstalls dependencies when the lockfile changes.
%/node_modules: %/package-lock.json
	cd $* && npm ci --no-audit --no-fund
	@touch $@

## up: starts api, gateway and minio and waits for the healthchecks.
up:
	HARNESS_VERSION=$(VERSION) HARNESS_COMMIT=$(COMMIT) docker compose up --build --detach --wait

## down: stops the services and keeps the sqlite-data and minio-data volumes.
down:
	docker compose down

## seed: loads the local sample data and the sample Marketplace into the running api (APP_ENV=local only; idempotent).
seed:
	docker compose exec -T api npm run --silent seed
	docker compose exec -T api npm run --silent seed:marketplace

## package-investimentos: validates, generates and packs the immutable Investimentos baseline.
.PHONY: package-investimentos
package-investimentos:
	go -C cli build -o bin/harness ./cmd/harness
	node marketplace/build-investimentos-base.mjs
