# Graphify e deja-vu no Claude Code

## Decisão de integração (#56)

O catálogo distribui duas **skills próprias do Smart Harness**, versão 1.0.0,
identificadas com `claude-code`. Elas instruem o agente a chamar a ferramenta local
pelo shell: `harness tools run <nome> ...`. Não são bundles oficiais upstream.

O comando curado `harness tools install` instala somente os dois produtos conhecidos,
com nomes/fontes fixados no binário harness. Não lê comandos de `plugin.json`, não
roda instaladores arbitrários do pacote e não muda a política de validação. Os
binários permanecem fora do catálogo. Nenhum MCP stdio ou hook é instalado.

| Entrada | Upstream fixado | Fonte verificada | Licença upstream | Pré-requisito |
|---|---|---|---|---|
| graphify@1.0.0 | graphifyy 0.9.56 / CLI graphify | [tag v0.9.56](https://github.com/Graphify-Labs/graphify/tree/v0.9.56), commit 67f99bd0059dd1bac9e44382907ef9f10098b39f | Apache-2.0; distribuição também contém LICENSE-MIT | uv e Python ≥3.10 |
| deja-vu@1.0.0 | deja 0.16.8 | [tag v0.16.8](https://github.com/vshulcz/deja-vu/tree/v0.16.8), commit 5e21a6ea6b7fc3256385822fe42402e6f56ed110 | MIT | Go ≥1.25 |

As skills são de autoria Smart Harness. Versão da skill e versão upstream são coisas
diferentes. Suporte a outras plataformas no upstream não representa validação pelo
nosso CLI. Apenas Claude Code está no escopo desta integração.

## Instalação e uso

Depois de instalar `harness`, `uv`, Python e Go, use os mesmos diretórios no setup e
na sessão Claude. Os overrides abaixo são opcionais e deixam a preparação isolada:

```sh
export HARNESS_CONFIG_DIR=/tmp/md2poui-demo/harness
export HARNESS_CLAUDE_DIR=/tmp/md2poui-demo/claude
export CLAUDE_CONFIG_DIR=/tmp/md2poui-demo/claude
harness tools install graphify
harness tools install deja-vu
harness tools check
harness setup md2poui --api-url http://127.0.0.1:8080 --include-optional graphify,deja-vu
```

`setup` depende do projeto/pacotes publicados na API e do token pessoal. Os dois
primeiros comandos só instalam ferramentas: não anunciam MCP ou skill como pronta.
O setup instala as skills pelo fluxo normal de pacotes. Binário ausente ou versão
incompatível impede setup/sync e gera instrução de reparo. `tools install` repetido
é idempotente e não altera configurações de outros plugins.

Dentro do checkout md2poui:

```sh
harness tools run graphify update ./src
harness tools run graphify explain md2poui --graph ./src/graphify-out/graph.json
harness tools run graphify explain adjustOptions --graph ./src/graphify-out/graph.json
```

O corpus é apenas `src`. Os artefatos ficam em `src/graphify-out/`; não devem entrar
no commit. Leia os arquivos apontados pelo grafo antes de editar. O comando `update`
usa AST local; não configure backend semântico ou API key para esse fluxo.

Na preparação, registre uma decisão **real** com `harness tools run deja-vu remember
"<decisão acordada e motivo>" --project md2poui --tag demo-preparation`. Em outro
processo ou sessão, consulte:

```sh
harness tools run deja-vu search --harness deja --project md2poui --no-embed --limit 3 demo-preparation
harness tools run deja-vu show <id-retornado>
```

`deja-vu index` atualiza o histórico existente; `remember` adiciona uma nota real.
Uma nota não é um transcript de Claude Code. Não fabricar conversas para a demo.
O indexador pode descobrir outros históricos locais mesmo com diretório de índice
isolado. Um perfil de sistema dedicado é o limite mais simples para excluir fontes
privadas da apresentação. Nenhum histórico ou credencial é incluído nos archives.

## Evidência de implementação

Em 2026-10-21, no macOS arm64, instalamos ambos os upstreams pelo novo comando em
`/private/tmp/sh-demo-tools-runtime`. As versões responderam 0.9.56 e 0.16.8;
repetir a instalação retornou `unchanged` para ambas. O Graphify analisou `src` do
md2poui em f097b94b0dd0dad367cdd7bb2f8312281a6ca90e: 86 nós, 170 arestas e 8
comunidades. `explain md2poui` retornou `index.ts:L31`, com chamadas a `Converter`,
`isFileOrDirectory` e `adjustOptions`. Isso prova navegação do corpus inspecionado,
não correção do aplicativo.

Uma nota real de preparação sobre corpus local e agentes separados foi registrada
com `remember`; outro processo `search --harness deja --project md2poui --no-embed --limit 3
demo-preparation` a recuperou. Essa verificação prova persistência/consulta entre
processos. A execução dessas ferramentas pelo Claude Code em nova sessão e o fluxo
completo de setup/publicação pertencem ao aceite integrado da demo; não foram
substituídos por esse teste de CLI.

## Pacotes reproduzíveis

```sh
make check-go
node marketplace/build-local-tools.mjs cli/bin/harness
```

O builder valida, gera a camada Claude Code em diretório temporário e empacota em
`control-plane/seed/packages`. Uma segunda execução recusa sobrescrever um archive
publicado com conteúdo diferente. Não embute os binários, índice nem notas. As
entradas do seed devem apontar aos arquivos `graphify-1.0.0.tar.gz` e
`deja-vu-1.0.0.tar.gz` e usar os relatórios `harness validate` como metadados.
