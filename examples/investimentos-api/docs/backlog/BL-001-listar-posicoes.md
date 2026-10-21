---
id: BL-001
title: Listar posições da carteira
status: done
priority: high
labels:
  - positions
  - api
related_decisions:
  - ADR-0001
  - ADR-0003
---

# BL-001 — Listar posições da carteira

Item histórico. A entrega está registrada em DL-001.

## Problema

O cliente não tem como consultar quais ativos a carteira possui, em que quantidade e a que preço médio.

## Proposta

Criar `GET /v1/portfolios/{portfolioId}/positions`. A rota confirma a carteira com `GetItem` e lê as posições com `Query` na partição da carteira.

## Critérios de aceite

- [x] `GET /v1/portfolios/{portfolioId}/positions` responde `200` com `portfolio_id` e a lista `positions`, ordenada por `symbol`.
- [x] Cada posição traz `symbol`, `quantity` e `average_price_cents`, com o preço médio em centavos inteiros.
- [x] Carteira sem posições responde `200` com `positions: []`.
- [x] Carteira inexistente responde `404` com `type` `portfolio-not-found` em `application/problem+json` (ADR-0003).
- [x] A leitura usa `GetItem` da carteira e `Query` por `begins_with(SK, "POSITION#")`; nenhum acesso usa `Scan` (ADR-0001).
- [x] Testes unitários no handler e teste de integração no `internal/dynamo`.
