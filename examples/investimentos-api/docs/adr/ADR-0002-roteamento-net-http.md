---
id: ADR-0002
title: Roteamento com net/http e http.ServeMux
status: accepted
date: "2026-10-21"
tags:
  - http
  - routing
  - dependencies
---

# ADR-0002 — Roteamento com `net/http` e `http.ServeMux`

## Contexto

A API tem três rotas, com método e parâmetro de path. Desde o Go 1.22, o `http.ServeMux` da stdlib aceita padrões como `GET /v1/orders/{orderId}` e entrega o parâmetro em `r.PathValue("orderId")`. Frameworks como chi, gin ou echo trazem middlewares e binding, mas também uma dependência a mais para manter.

## Decisão

Usar só `net/http`:

- rotas registradas com padrão de método em `internal/httpapi/handler.go`;
- parâmetros lidos com `r.PathValue`;
- timeout por request e log de acesso em um wrapper (`route`), sem biblioteca de middleware;
- `http.Server` com `ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout` e `IdleTimeout`, e shutdown no `SIGINT`/`SIGTERM`.

A única dependência externa do projeto é o AWS SDK for Go v2.

## Consequências

- Rota nova é uma linha `h.route(mux, "MÉTODO /path/{param}", handler)`.
- O log de acesso usa o padrão da rota (`route`), não o path cru. Isso mantém poucos valores distintos.
- Rota inexistente e método não permitido usam a resposta padrão do `ServeMux` (`404` e `405` em `text/plain`). Os erros da própria API usam `application/problem+json` (ADR-0003).
- Validação de corpo e mapeamento de erro são código próprio, pequeno e testado.
