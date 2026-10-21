---
id: BL-103
title: Idempotency-Key no POST de ordens
status: ready
priority: high
labels:
  - orders
  - api
  - reliability
related_decisions:
  - ADR-0001
  - ADR-0003
---

# BL-103 — `Idempotency-Key` no `POST` de ordens

## Problema

Se a conexão cai depois do `POST /v1/portfolios/{portfolioId}/orders`, o cliente não sabe se a ordem foi criada. Repetir o request cria uma segunda ordem.

## Proposta

Aceitar o header `Idempotency-Key`. A chave fica gravada junto com a ordem, na mesma escrita, e a repetição devolve a resposta original.

## Critérios de aceite

- [ ] O header é opcional. Sem ele, o comportamento atual não muda.
- [ ] Chave fora de `^[A-Za-z0-9-]{1,64}$` responde `400` `invalid-request`.
- [ ] Mesma chave, mesma carteira e mesmo corpo devolvem `201` com o mesmo `order_id` e o mesmo `Location`, sem criar outra ordem.
- [ ] Mesma chave com corpo diferente responde `409` em `application/problem+json`, com um `type` novo documentado no ADR-0003.
- [ ] A chave vale por carteira: a mesma chave em outra carteira não reaproveita a ordem.
- [ ] Ordem e registro da chave são gravados de forma atômica (`TransactWriteItems`); dois requests simultâneos com a mesma chave criam uma única ordem.
- [ ] O registro da chave expira em 24 horas por TTL do DynamoDB.
- [ ] Testes unitários table-driven e teste de integração com requests repetidos.
