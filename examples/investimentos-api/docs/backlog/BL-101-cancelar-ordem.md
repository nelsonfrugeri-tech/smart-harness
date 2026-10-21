---
id: BL-101
title: Cancelar ordem pendente
status: ready
priority: high
labels:
  - orders
  - api
related_decisions:
  - ADR-0001
  - ADR-0003
---

# BL-101 — Cancelar ordem pendente

## Problema

Hoje uma ordem nasce `pending` e nunca muda. O cliente não consegue desistir de uma ordem enviada por engano.

## Proposta

Criar `POST /v1/orders/{orderId}/cancel`. A rota localiza a ordem pelo `GSI1` e muda o status no item da tabela base com uma escrita condicional.

## Critérios de aceite

- [ ] `POST /v1/orders/{orderId}/cancel` em uma ordem `pending` responde `200` com a ordem e `status: "canceled"`.
- [ ] Um `GET /v1/orders/{orderId}` depois do cancelamento devolve `status: "canceled"`.
- [ ] Ordem inexistente responde `404` com `type` `order-not-found`.
- [ ] Ordem que não está `pending` responde `409` em `application/problem+json`, com um `type` novo documentado no ADR-0003.
- [ ] A troca de status usa `UpdateItem` com `ConditionExpression` sobre `status = pending`; dois cancelamentos simultâneos não geram duas escritas bem-sucedidas.
- [ ] Nenhum acesso usa `Scan` (ADR-0001).
- [ ] Testes unitários table-driven no handler e teste de integração no `internal/dynamo`.
