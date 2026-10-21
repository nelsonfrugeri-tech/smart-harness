---
id: BL-102
title: Paginar a listagem de posições
status: ready
priority: medium
labels:
  - positions
  - api
  - performance
related_decisions:
  - ADR-0001
  - ADR-0003
---

# BL-102 — Paginar a listagem de posições

## Problema

`GET /v1/portfolios/{portfolioId}/positions` lê todas as posições da carteira em uma resposta. Uma carteira grande gera uma resposta grande e várias páginas internas do DynamoDB em um único request.

## Proposta

Aceitar `limit` e `cursor` na query string. O cursor é opaco para o cliente e vem do `LastEvaluatedKey` da `Query`.

## Critérios de aceite

- [ ] `limit` é opcional, com padrão `50` e máximo `100`; fora de `1..100` responde `400` `invalid-request`.
- [ ] A resposta traz `next_cursor` quando há mais itens, e omite o campo na última página.
- [ ] Percorrer todas as páginas devolve cada posição uma única vez, na ordem de `symbol`.
- [ ] Cursor malformado, ou gerado para outra carteira, responde `400` `invalid-request`.
- [ ] Cada request faz no máximo uma `Query` com `Limit` e `ExclusiveStartKey`, sem `Scan` (ADR-0001).
- [ ] Sem `limit` e `cursor`, a resposta de uma carteira com até 50 posições continua igual à atual.
- [ ] Testes unitários table-driven e teste de integração com mais posições que o `limit`.
