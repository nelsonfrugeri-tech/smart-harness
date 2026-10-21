# Contrato do agente

Define o arquivo de agente do pacote e a regra única que o converte em agent do Claude Code. A spec Agent Plugins v1 cobre só skills e MCPs; o agente é uma extensão do projeto.

Fonte de verdade da conversão: este documento. Os exemplos em `cli/internal/engine/testdata/agents/` são os testes de aceitação do engine.

## Formato

Arquivo `dev.smartharness/agents/<nome>.agent.md`: frontmatter YAML e corpo Markdown. O corpo é o prompt.

| Campo | Obrigatório | Regra |
|---|---|---|
| `name` | sim | Igual a `<nome>` do arquivo. Só `a-z`, `0-9` e `-`. |
| `description` | sim | Texto de uma linha. Diz quando delegar ao agente. |
| `tools` | sim | Lista não vazia de tools lógicas (tabela abaixo). |
| `skills` | não | Lista de skills do pacote (`skills/<nome>/`). |
| `model` | não | `sonnet`, `opus`, `haiku`, `fable`, `inherit` ou ID completo `claude-...`. |

`tools` e `skills` aceitam lista YAML em bloco ou em linha.

## Campos proibidos

- `hooks`, `mcpServers`, `permissionMode`: o Claude Code ignora os três em agents de plugin; o contrato os rejeita.
- Qualquer outro campo fora da tabela acima: rejeitado.

## Tools lógicas

| Lógica | Claude Code |
|---|---|
| `read` | `Read`, `Glob`, `Grep` |
| `edit` | `Edit`, `Write` |
| `shell` | `Bash` |
| `delegate` | `Agent` |
| `mcp:<s>` | `mcp__plugin_<plugin>_<s>__*` |
| `mcp:<s>/<t>` | `mcp__plugin_<plugin>_<s>__<t>` |

`<plugin>` é o `name` do `plugin.json` do pacote. `<s>` deve existir em `mcp.json`. Em `<plugin>` e `<s>`, todo caractere fora de `A-Z a-z 0-9 _ -` vira `_`.

## Conversão para `agents/<nome>.md`

1. Valida o arquivo. Cada defeito tem um código (tabela de erros).
2. Emite o frontmatter nesta ordem: `name`, `description`, `tools`, `skills`, `model`. Omite o campo ausente.
3. `name` sai sem aspas. `description` sai entre aspas duplas, com escape de `"` e `\`.
4. `tools` sai em uma linha, separado por `, `. Expande cada tool na ordem escrita e remove duplicatas, mantendo a primeira ocorrência.
5. `skills` sai como lista em bloco, na ordem escrita, sem duplicatas.
6. O corpo vem depois de uma linha em branco, com fim de linha LF e sem linhas em branco no fim. O arquivo termina com um único `\n`.

A saída depende só da entrada: o mesmo pacote gera sempre os mesmos bytes.

## Erros

| Código | Defeito |
|---|---|
| `SH-AGT-001` | `tools` ausente ou vazio |
| `SH-AGT-002` | campo proibido (`hooks`, `mcpServers`, `permissionMode`) |
| `SH-AGT-003` | servidor MCP inexistente em `mcp.json` |
| `SH-AGT-004` | tool lógica desconhecida |
| `SH-AGT-005` | `name` diferente do nome do arquivo |
| `SH-AGT-006` | skill inexistente no pacote |
| `SH-AGT-007` | `model` inválido |
| `SH-AGT-008` | campo desconhecido |

## Exemplos

Cada caso é um pacote mínimo (`plugin.json`, `mcp.json`, `skills/`, `dev.smartharness/agents/`).

- `valid/<caso>/`: a saída esperada, escrita à mão, fica em `expected/agents/<nome>.md`.
- `invalid/<caso>/`: `expected.json` traz `{"code":"SH-AGT-00X"}`.

## Compatibilidade verificada

Doc oficial do Claude Code consultada em 2026-10-21 (subagents, MCP); validado com a versão 2.1.305. O nome de tool MCP de plugin segue `mcp__plugin_<plugin>_<servidor>__<tool>`. A doc de subagents documenta o curinga `mcp__<servidor>__*`; a forma com prefixo de plugin não é documentada e não foi exercitada em runtime. O nome de skill de plugin em `skills` também não é documentado.
