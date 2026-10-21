.PHONY: check check-go check-node up down seed

NODE_COMPONENTS := control-plane agent-gateway

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
COMMIT ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)
LDFLAGS := -X main.version=$(VERSION) -X main.commit=$(COMMIT)

## check: CLI formatting, vet, tests and build; API and gateway types, lint and tests.
check: check-go check-node

check-go:
	@files="$$(gofmt -l cli)"; if [ -n "$$files" ]; then echo "gofmt: unformatted files:"; echo "$$files"; exit 1; fi
	go -C cli vet ./...
	go -C cli test ./...
	go -C cli build -ldflags "$(LDFLAGS)" -o bin/harness ./cmd/harness

check-node: $(addsuffix /node_modules,$(NODE_COMPONENTS))
	@for c in $(NODE_COMPONENTS); do echo "== $$c"; (cd $$c && npm run --silent check) || exit 1; done

# Reinstalls dependencies when the lockfile changes.
%/node_modules: %/package-lock.json
	cd $* && npm ci --no-audit --no-fund
	@touch $@

## up: starts api and gateway and waits for the healthchecks.
up:
	HARNESS_VERSION=$(VERSION) HARNESS_COMMIT=$(COMMIT) docker compose up --build --detach --wait

## down: stops the services and keeps the sqlite-data volume.
down:
	docker compose down

## seed: loads the local sample data into the running api (APP_ENV=local only; idempotent).
seed:
	docker compose exec -T api npm run --silent seed
