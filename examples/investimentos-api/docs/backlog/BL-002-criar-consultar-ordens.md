---
id: BL-002
title: Criar e consultar ordens
status: done
priority: high
labels:
  - orders
  - api
related_decisions:
  - ADR-0001
  - ADR-0003
---

# BL-002 — Criar e consultar ordens

Item histórico. A entrega está registrada em DL-002.

## Problema

O cliente não tem como enviar uma ordem de compra ou venda para a carteira, nem acompanhar uma ordem enviada.

## Proposta

Criar `POST /v1/portfolios/{portfolioId}/orders` e `GET /v1/orders/{orderId}`. A ordem fica na partição da carteira e é lida por id no `GSI1`.

## Critérios de aceite

- [x] `POST /v1/portfolios/{portfolioId}/orders` com `symbol`, `side`, `quantity` e `price_cents` válidos cria uma ordem `pending` e responde `201` com o header `Location: /v1/orders/{orderId}`.
- [x] `GET /v1/orders/{orderId}` devolve a ordem criada.
- [x] `side` aceita só `buy` ou `sell`; `quantity` e `price_cents` são inteiros maiores que zero; `symbol` é obrigatório, com até 12 caracteres.
- [x] Corpo inválido ou campo desconhecido responde `400` `invalid-request`, com a lista `errors` por campo (ADR-0003).
- [x] Carteira inexistente responde `404` `portfolio-not-found`; ordem inexistente responde `404` `order-not-found`.
- [x] A ordem é gravada na partição da carteira e lida por id no `GSI1`; nenhum acesso usa `Scan` (ADR-0001).
- [x] Testes unitários no domínio e no handler, e teste de integração no `internal/dynamo`.

## Fora do escopo

- Cancelamento de ordem; ver BL-101.
- `Idempotency-Key` no `POST`; ver BL-103.
- Efeito da ordem sobre posições e validação de saldo.
