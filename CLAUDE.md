# CLAUDE.md

## Idioma
- Código sempre em inglês: identificadores, comentários, logs, mensagens de erro, help de CLI e Makefile, testes, fixtures, testdata e commits. Nada de pt-BR no código.
- Documentação em pt-BR (ADR, READMEs, `docs/`, issues e PRs), preservando termos técnicos em inglês.

## Simplicidade
- Código fácil de explicar: pastas por responsabilidade, nomes explícitos, poucas dependências justificadas no README do componente.
- No Node, libs padrão de mercado são bem-vindas.
- Sem padrões de resiliência (retry, backoff, circuit breaker) na Fase 1.
