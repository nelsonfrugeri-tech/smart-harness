# contributions

Contribuições de exemplo para o fluxo de publicação no Marketplace. `valid/` deve passar no `harness validate`. Cada variante `invalid-*` é uma cópia de `valid/` com um único defeito e falha com um único código.

| Pasta | O que é | Resultado esperado |
|---|---|---|
| `valid/` | Plugin `go-software-engineer`: um agente e a skill `http-contract-testing` | Válido, sem achados |
| `invalid-literal-secret/` | `mcp.json` com header `Authorization` literal | `SH-SEC-001` |
| `invalid-external-mcp/` | `mcp.json` com URL fora do gateway | `SH-MCP-001` |
| `invalid-stdio/` | `mcp.json` com MCP local por comando (`stdio`) | `SH-MCP-002` |
| `invalid-name/` | Nome de plugin reservado pelo Claude Code (`claude-go-engineer`) | `SH-NAM-001` |

Os valores de "segredo" são falsos. O pacote inteiro está em inglês, como manda o `CLAUDE.md`.

O teste `cli/cmd/harness/contributions_test.go` roda o validador real nas cinco pastas e entra no `make check`. As regras estão em `cli/README.md`.

```bash
go -C cli build -o bin/harness ./cmd/harness
cli/bin/harness validate marketplace/contributions/valid --json
```
