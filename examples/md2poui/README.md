# Demo TOTVS md2poui

Contexto da tarefa demonstrada. O código executável fica no fork, fora deste
repositório: https://github.com/nelsonfrugeri-tech/md2poui.

## Estado inicial e tarefa

- Upstream: https://github.com/totvs/md2poui.
- Commit-base: `f097b94b0dd0dad367cdd7bb2f8312281a6ca90e`.
- Branch preservado no fork: `demo-start`, no mesmo commit-base.
- História: [BL-001](docs/backlog/BL-001-cli-home.md).
- Decisão: [ADR-001](docs/adr/ADR-001-cli-home.md).
- Board de preparação: https://trello.com/b/P5hqNFlq/smart-harness.
- História publicada (TOTVS-001): https://trello.com/c/DbOOTPco.
- ADR publicada: https://www.notion.so/401c02b3ab6c80719473cce961f7a2ec.
- Os links são recíprocos. A publicação não comprova leitura pelo gateway; essa etapa pertence ao ensaio integrado.

## Reproduzir sem implementar a solução

Em um diretório novo, com Node.js 24 e npm:

```sh
git clone --branch demo-start https://github.com/nelsonfrugeri-tech/md2poui.git
cd md2poui
npm ci --ignore-scripts
npm test
node dist/bin/md2poui.js test/markdown /tmp/md2poui-before
```

Revalidação em 21/10/2026 com Node.js 24.19.0: `npm test` passou 10 testes e compilou
TypeScript. O comando da CLI terminou com código 1 e
`TypeError: Cannot read properties of undefined (reading 'replace')`. O código-fonte
declara posicionais `srcPath/destDir`, mas encaminha `source/destination`.
A biblioteca já possui `home=true`; a CLI ainda não encaminha essa opção.

O `package.json` no commit-base declara MIT. Não há LICENSE na raiz. Preservar a
atribuição e a declaração do upstream; não inventar copyright ou inserir um texto
como se fosse uma licença publicada pelos autores.

## Configurar o projeto na plataforma

`make seed` cria o projeto `md2poui` no tenant local `investimentos`. As credenciais
ficam no gateway; os IDs de recursos definem a autorização do projeto. No `.env`
local, configure apenas os recursos da demo:

```dotenv
DEMO_GITHUB_REPO=nelsonfrugeri-tech/md2poui
DEMO_TRELLO_BOARD_ID=6ad914e240df9fe7aff0c9b2
DEMO_NOTION_PAGE_IDS=401c02b3ab6c80719473cce961f7a2ec
```

`DEMO_NOTION_PAGE_IDS` identifica a ADR publicada. Não use a página pai
para autorizar todas as páginas: a autorização é por ID. As variáveis
`GITHUB_TOKEN`, `TRELLO_API_KEY`, `TRELLO_TOKEN` e `NOTION_TOKEN` precisam estar
configuradas no ambiente e autorizadas nos respectivos serviços. Depois de mudar
o `.env`, execute `docker compose up -d` e `make seed`.

Os campos `DEMO_*` vazios revogam as permissões correspondentes ao executar o seed.
As permissões do exemplo `investimentos-api` continuam independentes. O seed não
prova autenticação. Antes da demo, obter um token de gateway do projeto `md2poui`
e comprovar as leituras do fork, card e ADR pelas ferramentas MCP, com URLs nas
respostas. Ler os arquivos locais deste diretório não substitui essa comprovação.

## Histórico e ensaios

Esta decisão foi registrada durante a preparação real: manter a API da biblioteca,
usar a opção `home` existente e preservar o branch inicial. A recuperação pelo
deja-vu deve apontar a sessão/registro real que contém a decisão. Não fabricar
conversas, resultado de busca, comentários de review ou aprovação.

Para reiniciar, preservar os PRs e branches do ensaio anterior e criar outro
checkout/branch a partir de `origin/demo-start`:

```sh
git fetch origin demo-start
git worktree add -b demo/cli-home-run-02 ../md2poui-run-02 origin/demo-start
```

Usar um nome novo por ensaio; não executar reset/force-push no histórico anterior.
O PR e eventual merge são somente no fork. O branch `demo-start` fica preservado
mesmo depois do merge em `master`. Esta preparação não implementa a correção.
