# Contrato do agente

Define o arquivo de agente do pacote e a regra única que o converte em agent do Claude Code. A spec Agent Plugins v1 cobre só skills e MCPs; o agente é uma extensão do projeto.

Fonte de verdade da conversão: este documento.

## Formato

Arquivo `dev.smartharness/agents/<nome>.agent.md`: frontmatter YAML e corpo Markdown. O corpo é o prompt.

| Campo | Obrigatório | Regra |
|---|---|---|
| `name` | sim | Nome do agente. Define o arquivo de saída `agents/<name>.md`. |
| `description` | sim | Texto de uma linha. Diz quando delegar ao agente. |
| `tools` | sim | Lista não vazia de tools lógicas (tabela abaixo). |
| `skills` | não | Lista de nomes de skills. Sai entre aspas duplas. |
| `model` | não | Sai como está. Valores aceitos pelo Claude Code: `sonnet`, `opus`, `haiku`, `fable`, `inherit` ou ID completo `claude-...`. |

`tools` e `skills` aceitam lista YAML em bloco ou em linha. Outros campos não são validados e não saem na conversão.

O frontmatter é YAML simples. São rejeitados com `SH-STR-003`, em qualquer nível: anchor (`&`), alias (`*`), merge key (`<<`), tag explícita (`!!str`, `!x`), chave que não é string, chave repetida e segundo documento YAML.

## Campos proibidos

`hooks`, `mcpServers` e `permissionMode`: o Claude Code ignora os três em agents de plugin; o contrato os rejeita. A regra vale para as chaves escritas e para o mapa depois de resolver merge e alias.

## Tools lógicas

| Lógica | Claude Code |
|---|---|
| `skill` | `Skill` |
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
5. `skills` sai como lista em bloco, na ordem escrita, sem duplicatas. Cada nome sai entre aspas duplas, com escape de `"` e `\`, para continuar string (`123`, `true` e `null` não viram número, booleano ou null).
6. O corpo vem depois de uma linha em branco, com fim de linha LF e sem linhas em branco no fim. O arquivo termina com um único `\n`.

A saída depende só da entrada: o mesmo pacote gera sempre os mesmos bytes.

## Erros

| Código | Defeito |
|---|---|
| `SH-AGT-001` | `tools` ausente ou vazio |
| `SH-AGT-002` | campo proibido (`hooks`, `mcpServers`, `permissionMode`) |
| `SH-AGT-003` | tool lógica desconhecida |
| `SH-AGT-004` | servidor MCP não declarado em `mcp.json` do pacote |
| `SH-STR-003` | recurso de YAML fora do frontmatter simples (anchor, alias, merge key, tag, chave repetida, segundo documento) |
| `SH-AGT-005` | arquivo malformado: sem frontmatter; `name` ou `description` ausente ou inválido; `name` diferente do nome do arquivo; `tools`, `skills` ou `model` fora do formato; corpo vazio |

`SH-AGT-005` protege a saída: `name` vira nome de arquivo e sai sem aspas, então só aceita `a-z 0-9 -`, começando por letra; `description` deve ter uma linha; `skills` e `model` só aceitam `A-Z a-z 0-9 . _ : [ ] -`; `model` sai sem aspas.

## Exemplos

`cli/internal/engine/testdata/agents/` tem um par:

- `reviewer.agent.md`: entrada.
- `reviewer.md`: saída esperada, escrita à mão.

O pacote do exemplo tem `name` `example` no `plugin.json` e o servidor `docs` no `mcp.json`.

Os casos inválidos não têm arquivo. O teste do engine (#9) os cobre em tabela, com o agente em string inline:

| Caso | Entrada | Código |
|---|---|---|
| `tools` ausente | frontmatter sem `tools` | `SH-AGT-001` |
| campo proibido | `hooks`, `mcpServers` ou `permissionMode` no frontmatter | `SH-AGT-002` |
| tool desconhecida | `tools` com valor fora da tabela de tools lógicas | `SH-AGT-003` |
| MCP não declarado | `mcp:<s>` com `<s>` ausente do `mcp.json` | `SH-AGT-004` |

## Compatibilidade verificada

Doc oficial do Claude Code consultada em 2026-10-21 (subagents, MCP); validado com a versão 2.1.305. O nome de tool MCP de plugin segue `mcp__plugin_<plugin>_<servidor>__<tool>`. A doc de subagents documenta o curinga `mcp__<servidor>__*`; a forma com prefixo de plugin não é documentada e não foi exercitada em runtime. O nome de skill de plugin em `skills` também não é documentado.

O campo `skills` não faz preload no modo `claude --agent ... -p` observado em runtime.
Agentes que precisam das skills nesse modo declaram a tool lógica `skill` e instruem
a chamada de `Skill` com o nome qualificado `<plugin>:<skill>` antes da resposta.
Isso permite carregamento sob demanda; não concede shell, escrita ou delegação.
