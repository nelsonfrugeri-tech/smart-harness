---
id: DL-001
title: Listar posições da carteira
delivered_at: "2026-10-21"
backlog_id: BL-001
---

# DL-001 — Listar posições da carteira

## O que foi entregue

`GET /v1/portfolios/{portfolioId}/positions` devolve as posições da carteira, ordenadas por `symbol`.

```json
{
  "portfolio_id": "p-1",
  "positions": [
    { "symbol": "PETR4", "quantity": 100, "average_price_cents": 3852 },
    { "symbol": "VALE3", "quantity": 50, "average_price_cents": 6120 }
  ]
}
```

## Comportamento

- Carteira sem posições: `200` com `positions: []`.
- Carteira inexistente: `404` `portfolio-not-found` (ADR-0003).
- Leitura com `GetItem` da carteira e `Query` por `begins_with(SK, "POSITION#")`, sem `Scan` (ADR-0001).
- O preço médio está em centavos inteiros.

## Limitações

- Sem paginação; ver BL-102.
