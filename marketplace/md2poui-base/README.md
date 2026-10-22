# Agentes da demo TOTVS

Fonte canônica dos agentes `md2poui-base:developer` e `md2poui-base:reviewer`, com skills
incluídas. O developer lê/edita/executa testes. O reviewer lê e executa testes/comandos GitHub
em checkout separado; não tem Edit/Write e o prompt proíbe mudanças no produto. **Bash não
é sandbox**: o host mantém as permissões reais. Ambos usam project, GitHub, Trello e Notion
pelo gateway do projeto `md2poui`. O GitHub MCP é somente leitura; publicação usa `git`/`gh`
local autenticado e restrito pelo procedimento ao fork autorizado.

## Build e instalação

```bash
make package-md2poui
make seed
harness setup md2poui
harness tools install graphify
harness tools install deja-vu
harness tools check
claude --agent md2poui-base:developer
```

Em outra sessão independente:

```bash
claude --agent md2poui-base:reviewer
```

Os comandos de local tools exigem a entrega da #56. Configurar os recursos autorizados do
projeto e a autenticação antes do ensaio. O [contexto da demo](../../examples/md2poui/README.md)
explica as variáveis do cenário. Skills fazem descoberta pelos conectores; não embutem URLs
de páginas ou credenciais pessoais. Falha de conector/histórico é reportada, nunca simulada.

O build usa validate → generate → validate → pack no engine real, em pasta temporária.
Também gera `md2poui-development` e `md2poui-review`, pacotes somente de skill para o catálogo
filtrado por tipo. Eles copiam as skills desta fonte canônica durante o build; não contêm
agentes e são opcionais. O baseline completo funciona sem instalá-los. Os três pacotes usam
`claude-code` nas keywords. Archives publicados são imutáveis; alterações exigem nova versão.

## Limite da verificação

Os testes de pacote verificam geração para Claude Code, ferramentas declaradas, skills
incluídas e bytes reproduzíveis. Isso não prova que um modelo executou o fluxo: o aceite #49
precisa demonstrar leitura real dos conectores, Graphify, histórico real, tarefa no fork,
PR, review independente e merge. Nenhuma solução ou comentário de review vem pronto aqui.
