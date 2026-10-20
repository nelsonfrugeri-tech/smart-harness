.PHONY: check check-go check-node up down seed

NODE_COMPONENTS := control-plane agent-gateway

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
COMMIT ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)
LDFLAGS := -X main.version=$(VERSION) -X main.commit=$(COMMIT)

## check: formatação, vet, testes e build do CLI; tipos, lint e testes da API e do gateway.
check: check-go check-node

check-go:
	@files="$$(gofmt -l cli)"; if [ -n "$$files" ]; then echo "gofmt: arquivos mal formatados:"; echo "$$files"; exit 1; fi
	go -C cli vet ./...
	go -C cli test ./...
	go -C cli build -ldflags "$(LDFLAGS)" -o bin/harness ./cmd/harness

check-node: $(addsuffix /node_modules,$(NODE_COMPONENTS))
	@for c in $(NODE_COMPONENTS); do echo "== $$c"; (cd $$c && npm run --silent check) || exit 1; done

# Reinstala as dependências quando o lockfile muda.
%/node_modules: %/package-lock.json
	cd $* && npm ci --no-audit --no-fund
	@touch $@

## up: sobe api e gateway e espera os healthchecks.
up:
	HARNESS_VERSION=$(VERSION) HARNESS_COMMIT=$(COMMIT) docker compose up --build --detach --wait

## down: para os serviços e preserva o volume sqlite-data.
down:
	docker compose down

seed:
	@echo "seed: definido em #6"
