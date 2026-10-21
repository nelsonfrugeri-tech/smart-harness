# marketplace

Conteúdo do Marketplace interno no formato Agent Plugins. O núcleo contém agentes na extensão
`dev.smartharness/agents/`, skills em `skills/` e os endpoints do Agent Gateway em `mcp.json`.

## Pacote base de Investimentos

`investimentos-base/` é a fonte canônica da versão `1.2.0`:

| Componente | Uso |
| --- | --- |
| `investimentos-guide` | Onboarding e perguntas com consulta e citação de fontes reais |
| `reviewer` | Revisão somente leitura contra critérios de aceite e ADRs |
| `go-idioms` | Convenções Go, erros, testes e limites entre componentes |
| `dynamodb-single-table` | Acessos por chave, índices e consistência conforme ADR-0001 |
| `dev-workflow` | Discovery → refinamento → desenvolvimento → testes → self-review → PR → revisão independente → finalização |
| MCPs `project`, `github`, `trello`, `notion` | Leitura de contexto, código, backlog e documentação pelo gateway |

Os agentes não têm shell nem escrita. As skills são declaradas por nome simples no contrato.
O fluxo de desenvolvimento é SDD leve: a task e seus critérios de aceite são a spec. A adoção
de uma ferramenta externa como Spec Kit é uma decisão separada.

O núcleo não contém credenciais, `headers` ou `env`. O converter gera a autenticação por variável
e os nomes de tools do Claude Code. Na ausência de autenticação ou de fontes, o agente deve
explicitar o desconhecido e sugerir `harness doctor`, sem inventar contexto.

## Gerar e publicar o seed local

Na raiz do repositório:

```bash
make package-investimentos
make seed
```

O primeiro comando usa o engine real para validar a fonte, gerar a camada Claude Code numa
pasta temporária, validar novamente e empacotar. Grava o archive em
`control-plane/seed/packages/investimentos-base-1.2.0.tar.gz`; o segundo carrega o seed na stack
local já iniciada. O build recusa substituir uma versão existente com bytes diferentes: uma
mudança exige incremento de `version` e nova entrada no seed. As versões `1.0.0` e `1.1.0`
permanecem disponíveis, com seus archives originais. O baseline de `investimentos-api` passa a
`1.2.0` quando o seed roda. `harness sync` aplica o novo plano numa instalação existente.

A fonte canônica não recebe arquivos gerados. É possível escolher um binário já compilado:

```bash
node marketplace/build-investimentos-base.mjs /caminho/para/harness
```

## Verificação com o coding agent

Com a API, o gateway e as credenciais locais configurados:

```bash
harness setup investimentos-api
harness doctor
claude --agent investimentos-base:investimentos-guide
```

Pergunte como o projeto está organizado e peça a fonte das decisões. Confira as chamadas ao
MCP `project`, as citações de ADRs e o carregamento das três skills. Depois consulte código,
backlog e páginas autorizadas pelos demais MCPs. O teste automatizado da CLI compara os bytes
do archive com a fonte e o converter; ele não comprova carregamento no Claude Code nem acesso
aos serviços externos. Essas etapas exigem a verificação de runtime acima.

Exemplos válidos e inválidos de contribuição ficam em [`contributions/`](contributions/README.md).
