---
id: ADR-0003
title: Erros no formato application/problem+json (RFC 9457)
status: accepted
date: "2026-10-21"
tags:
  - http
  - errors
  - api-contract
---

# ADR-0003 — Erros no formato `application/problem+json` (RFC 9457)

## Contexto

O cliente precisa distinguir os erros por máquina, sem interpretar texto. A RFC 9457 (Problem Details for HTTP APIs) define um corpo JSON padrão para isso.

## Decisão

Todo erro gerado pela API responde com `Content-Type: application/problem+json` e os campos:

| Campo | Conteúdo |
| --- | --- |
| `type` | URI estável do problema, em `https://investimentos.example/problems/<slug>` |
| `title` | Resumo curto e fixo do tipo |
| `status` | O mesmo status HTTP da resposta |
| `detail` | Explicação desta ocorrência |
| `instance` | Path do request |
| `errors` | Só em `invalid-request`: lista de `{field, message}` |

Tipos atuais:

| Status | `type` (slug) | Quando |
| --- | --- | --- |
| 400 | `invalid-request` | JSON inválido, campo desconhecido, `side` fora de `buy`/`sell`, `quantity <= 0`, `price_cents <= 0`, `symbol` ausente |
| 404 | `portfolio-not-found` | Carteira inexistente |
| 404 | `order-not-found` | Ordem inexistente |
| 500 | `internal-error` | Falha não prevista. A causa vai só para o log |

O domínio `.example` é reservado (RFC 2606). O URI identifica o tipo, mas não aponta para um site real.

## Consequências

- O cliente decide pelo `type`, não pelo texto de `detail`.
- Um novo erro exige um novo `type` documentado aqui.
- Erros de infraestrutura não vazam para o cliente.
- Dinheiro trafega sempre em centavos inteiros (`price_cents`, `average_price_cents`). Valor decimal em `quantity` ou `price_cents` é 400.
