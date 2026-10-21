---
id: ADR-0001
title: Tabela única no DynamoDB, sem Scan
status: accepted
date: "2026-10-21"
tags:
  - dynamodb
  - data-model
  - performance
---

# ADR-0001 — Tabela única no DynamoDB, sem Scan

## Contexto

A API guarda três entidades: carteira (portfolio), posição (position) e ordem (order). Os acessos conhecidos são poucos:

1. listar as posições de uma carteira;
2. criar uma ordem em uma carteira;
3. ler uma ordem pelo `orderId`, sem saber a carteira.

No DynamoDB, um `Scan` lê a tabela inteira. O custo e a latência crescem com o volume total, não com o resultado.

## Decisão

Usar uma tabela única, `investimentos`, com chave composta `PK`/`SK` e um GSI, `GSI1` (`GSI1PK`/`GSI1SK`, projeção `ALL`).

| Entidade | `PK` | `SK` | `GSI1PK` | `GSI1SK` |
| --- | --- | --- | --- | --- |
| portfolio | `PORTFOLIO#<id>` | `PORTFOLIO` | — | — |
| position | `PORTFOLIO#<id>` | `POSITION#<symbol>` | — | — |
| order | `PORTFOLIO#<id>` | `ORDER#<orderId>` | `ORDER#<orderId>` | `ORDER` |

Cada acesso vira uma operação por chave:

| Acesso | Operação |
| --- | --- |
| Carteira existe? | `GetItem` em `PORTFOLIO#<id>` / `PORTFOLIO` |
| Listar posições | `Query` com `PK = PORTFOLIO#<id>` e `begins_with(SK, "POSITION#")` |
| Criar ordem | `PutItem` com `attribute_not_exists(PK)` |
| Ler ordem por id | `Query` em `GSI1` com `GSI1PK = ORDER#<orderId>` |

**Regra:** o código não usa `Scan`. Um novo acesso exige um novo desenho de chave ou de índice, registrado em ADR.

Os IDs aceitos pela API seguem `^[A-Za-z0-9-]{1,64}$`. Assim, `#` nunca entra em uma chave vinda do cliente.

## Consequências

- Toda leitura custa proporcional ao resultado, não ao tamanho da tabela.
- Posições e ordens da mesma carteira ficam na mesma partição. Uma carteira com muitas ordens vira uma partição grande; o prefixo de `SK` separa os dois tipos na leitura.
- Leitura em GSI é eventualmente consistente na AWS. Logo após o `POST`, um `GET /v1/orders/{orderId}` pode responder 404 por um instante. O DynamoDB Local não mostra esse atraso.
- A listagem de posições ainda lê a partição inteira de posições. A paginação está no backlog (BL-102).
- Uma ordem de compra não altera posições nem valida saldo. Isso não faz parte desta versão.
