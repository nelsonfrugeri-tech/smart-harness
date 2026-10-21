---
id: DL-002
title: Criar e consultar ordens
delivered_at: "2026-10-21"
backlog_id: BL-002
---

# DL-002 — Criar e consultar ordens

## O que foi entregue

- `POST /v1/portfolios/{portfolioId}/orders` cria uma ordem `pending` e responde `201` com o header `Location: /v1/orders/{orderId}`.
- `GET /v1/orders/{orderId}` devolve a ordem.

Corpo do `POST`:

```json
{ "symbol": "PETR4", "side": "buy", "quantity": 10, "price_cents": 3850 }
```

## Comportamento

- `side` aceita só `buy` ou `sell`. `quantity` e `price_cents` são inteiros maiores que zero. `symbol` é obrigatório, com até 12 caracteres.
- Corpo inválido ou campo desconhecido: `400` `invalid-request`, com a lista `errors` por campo (ADR-0003).
- Carteira inexistente: `404` `portfolio-not-found`. Ordem inexistente: `404` `order-not-found`.
- A ordem fica na partição da carteira e é lida por id no `GSI1` (ADR-0001).

## Limitações

- Sem cancelamento; ver BL-101.
- Repetir o `POST` cria outra ordem; ver BL-103.
- A ordem não altera posições nem valida saldo.
