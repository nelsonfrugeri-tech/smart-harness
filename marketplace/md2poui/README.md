# Skills do md2poui

Pacote `md2poui@1.0.0` com conhecimento do repositório TOTVS, sem agentes, MCPs,
credenciais ou projeto de workspace. Pode ser combinado com agentes e conectores
selecionados pelo usuário.

| Skill | Quando usar |
| --- | --- |
| `md2poui-cli-options` | Argumentos, defaults, overloads e testes de subprocesso |
| `md2poui-markdown-rendering` | Títulos, escapes, links, HTML e assets |
| `md2poui-angular-generation` | Componentes, templates, home, rotas, menus e seleção de arquivos |

As referências descrevem a revisão upstream `f097b94b0dd0dad367cdd7bb2f8312281a6ca90e`,
inspecionada em 2026-10-22, e distinguem implementação observada de cobertura ausente.
Graphify foi usado para localizar relações de Converter; fonte, templates e os dois
arquivos de teste foram conferidos diretamente. Não há solução antecipada da tarefa.

O build ocorre pelo engine real, com `node marketplace/build-personal-skills.mjs` após
compilar `cli/bin/harness`. Os agentes genéricos ficam em `software-delivery`; a revisão
geral fica em `code-review`. Os pacotes antigos `md2poui-base`, `md2poui-development` e
`md2poui-review` permanecem imutáveis como versões legadas, sem serem pré-requisito.
