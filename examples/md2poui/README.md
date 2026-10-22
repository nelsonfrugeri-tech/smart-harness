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

## Skills e conectores pessoais

O repositório TOTVS é o alvo da tarefa, não um projeto cadastrado no workspace.
Selecione o pacote `md2poui` para obter as skills de CLI/opções, renderização Markdown
e geração Angular. A skill geral de revisão é disponibilizada pelo pacote `code-review`.

Conectores são selecionados e autorizados na conta pessoal. O cenário usa GitHub para
o fork, Trello para a história e Notion para a ADR; Graphify e deja-vu auxiliam a navegação
e a recuperação de decisões reais quando disponíveis. Os pacotes não embutem credenciais
 nem exigem um workspace `md2poui`. Endpoints e ferramentas pertencem aos conectores.

Antes da demo, comprovar a leitura do fork, card e ADR pelas ferramentas efetivamente
instaladas. Ler as cópias locais desta pasta não substitui essa comprovação. As URLs
documentadas identificam o cenário, não concedem acesso nem demonstram autenticação.
As instruções antigas de `harness setup md2poui` pertencem ao fluxo legado.

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
