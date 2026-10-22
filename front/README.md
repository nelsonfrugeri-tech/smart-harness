# Smart Harness — frontend

Workspace React + TypeScript + Vite integrado à API. Login local, identidade e
papéis por squad, projetos autorizados e composição do pacote base nas versões
fixadas pelo backend. Catálogo de Conectores e Skills com busca, filtros por tipo,
complementos por projeto e paginação real. Interface em pt-BR; tipos HTTP gerados do OpenAPI.

## Executar com a API local

Pré-requisitos: Docker/Compose e Node 24. Na raiz do repositório, prepare o `.env`
a partir de `.env.example` apenas se ele ainda não existir, depois:

```sh
make up
make seed
```

Em outro terminal:

```sh
cd front
npm ci --cache ./.npm-cache --no-audit --no-fund
npm run dev -- --port 5173
```

Abra <http://127.0.0.1:5173>. O servidor Vite encaminha `/v1` à API em
`http://127.0.0.1:8080`. Para outra instância local:

```sh
HARNESS_API_TARGET=http://127.0.0.1:18080 npm run dev -- --port 15173
```

`HARNESS_API_TARGET` configura somente o proxy do servidor, sem ser incluído no
bundle. Nenhuma credencial ou `JWT_SECRET` deve ser configurada no frontend.
Login por email só existe na API com `APP_ENV=local`. Fora desse ambiente o
formulário informa que o login local está indisponível; integração OIDC é futura.

## Demonstrar a jornada TOTVS

Siga [docs/onboarding.md](../docs/onboarding.md). Depois do seed da demo, entre
como `dev@smart-harness.local` e abra **Preparar demo TOTVS**, disponível tanto
no workspace quanto no catálogo **Conectores e Skills** para quem tem acesso.
A página usa o plano real de `md2poui`, conserva os pins e mostra clone do fork,
setup, diagnóstico, ferramentas locais e abertura das sessões de desenvolvimento
/review. Os agentes só recebem comando quando estão presentes no baseline.

O usuário gera o token em **Meus tokens**, baixa a CLI e trabalha no checkout
`md2poui`. A CLI deve oferecer `tools --help`; o link aponta para releases/latest,
sem afirmar que uma versão antiga possui as ferramentas da demo. O browser não
confirma instalação, saúde ou conexão apenas porque um comando foi copiado.

Os projetos existentes continuam acessíveis por card, seletor e URL. Teste uma
conta sem `md2poui`: o atalho da demo não deve aparecer. Para testar erro sem parar
serviços compartilhados, use **Network → Offline**, navegue ao projeto e depois
volte online e use **Tentar novamente**. Teste Tab/Shift+Tab, Enter, Escape no menu
mobile e larguras 390, 768 e 1440 px.

## Demonstrar o Marketplace

1. Entre como `dev@smart-harness.local` e abra **Conectores e Skills**. Os cards mostram
   pacote, descrição, contagem por componente, squad dona e versão visível. O pacote privado `cartoes-base` não aparece.
2. Pesquise `github` no campo principal do catálogo e pressione Enter. Ative **Conectores**: a consulta usa `type=connector` da API. Tags visíveis usam
   `keywords`; clicar em uma tag faz busca textual por `q`, sem correspondência exata.
3. Use **Limpar filtros** e, em **Pacotes disponíveis**, selecione **Complementos de Investimentos API** (ou use **Explorar
   complementos** na página do projeto). `code-review` aparece; o pacote base
   `investimentos-base` não aparece entre os complementos. **Todos os pacotes disponíveis**
   remove o contexto de projeto; **Limpar filtros** também remove busca e tipo.
4. Recarregue a URL, abra um pacote e use **Voltar aos resultados**. Busca, tipo e
   projeto permanecem na URL. Teste também voltar/avançar do navegador.
5. Abra `/marketplace?limit=1` para exercitar a paginação do backend. Clique
   **Carregar mais** até o fim. O indicador informa pacotes carregados, sem inventar
   um total global. `limit` aceita inteiros de 1 a 100; o padrão é 20.
6. Com a primeira página carregada, ative **Network → Offline** e clique **Carregar
   mais**. Os cards permanecem; volte para **Online** e use **Tentar novamente**.
   Não é necessário parar nenhuma API compartilhada. Cursor inválido oferece
   **Reiniciar consulta**, coberto por teste determinístico de resposta HTTP.
7. Saia e entre como `dev.cartoes@smart-harness.local`. Confira `cartoes-base` e
   `code-review` organizacional, sem os pacotes de Conta/Investimentos. Uma URL de
   complementos sem acesso mostra indisponibilidade, e não uma busca vazia.

A tela de pacote desta entrega agrupa agentes, skills e MCPs da última versão
visível. Os botões selecionam o tipo calculado pelo backend (Todos, Conectores e Skills); Tab,
Enter e Espaço permitem operá-los mantendo o foco. Há uma única busca no catálogo,
logo abaixo do título, e busca no shell nas demais páginas. O histórico paginado permite baixar versões específicas sem mudar a composição
em exibição. Tokens e setup estão disponíveis na jornada do projeto.

## Baixar e conferir um pacote

1. Entre como `dev@smart-harness.local`, abra `investimentos-base` no Marketplace
   e confira versão, squad, visibilidade, tamanho e SHA-256 publicado.
2. Clique **Baixar v1.1.0**. O frontend busca o arquivo com Bearer e `no-store`,
   valida status, tipo gzip, assinatura, tamanho e SHA-256 dos bytes recebidos.
   Somente então envia o arquivo ao navegador. A confirmação informa integridade
   conferida; baixar não instala o pacote.
3. No histórico, baixe `1.0.0`: os componentes acima continuam sendo da versão
   em exibição. Abra `/marketplace/packages/investimentos-base?limit=1` para
   exercitar paginação real do histórico em páginas de uma versão.
4. Abra o pacote base pelo workspace de Investimentos. A URL
   `/workspace/projects/investimentos-api/packages/investimentos-base/versions/1.1.0`
   conserva o projeto e a versão fixada no reload. O frontend relê o setup-plan;
   um pin removido ou alterado mostra indisponibilidade, sem substituir por latest.
5. Com a tela aberta, use **Network → Offline** antes do download; nenhum arquivo
   deve ser salvo. Volte para **Online** e tente novamente. Uma resposta 401 encerra
   a sessão; 404 não distingue ausência de falta de acesso; erro de storage oferece
   retry. Para testar storage, pare somente um MinIO de stack isolada que você possua.
6. No terminal, confira o arquivo salvo. Ajuste o caminho conforme a pasta de downloads
   configurada no navegador e copie o digest da versão consultada:

```sh
PACKAGE_ARCHIVE="$HOME/Downloads/investimentos-base-1.1.0.tar.gz"
PACKAGE_DIGEST='sha256:COLE_O_DIGEST_PUBLICADO'
shasum -a 256 "$PACKAGE_ARCHIVE"
# Na raiz do repositório; gera o binário somente dentro de front/:
go -C cli build -o ../front/.harness-test ./cmd/harness
./front/.harness-test unpack "$PACKAGE_ARCHIVE" ./front/.package-test --expect-digest "$PACKAGE_DIGEST"
```

O diretório de extração deve estar vazio ou não existir. `harness unpack` confere
integridade e regras de extração do pacote. Os artefatos locais `.harness-test` e
`.package-test/` estão ignorados pelo Git. Não envie o token na URL nem no comando.

O download usa Web Crypto em HTTPS ou localhost, timeout de 30 segundos e memória
proporcional ao arquivo. O arquivo não é mantido em cache pelo frontend; a object URL
é revogada após sua ativação. Troca de sessão ou saída da tela cancela requests em
andamento e impede salvar respostas tardias. O frontend não valida a semântica dos
arquivos internos; a verificação do pacote é feita pela CLI.

## Verificar e gerar tipos

```sh
npm run contract:types
npm run check
```

`contract:types` gera `src/api/schema.d.ts` a partir de
`../control-plane/openapi.json`, usando `openapi-typescript` com versão resolvida
no lockfile. Não editar o arquivo gerado. `contract:check` regenera em memória e
falha se o resultado versionado estiver desatualizado.

`make check`, na raiz, inclui o frontend no mesmo gate executado pelo CI.
`check` executa contrato → Prettier → ESLint → Vitest → TypeScript estrito e build.
`npm test` exercita o HTTP client e o fluxo público renderizado: login, erros,
retry, vazio, versões fixadas, troca de identidade, cancelamento, timeout e
respostas atrasadas. Vitest e Testing Library permitem controlar essas falhas;
o roteiro acima valida a integração com API/SQLite/MinIO reais.

`npm run build` produz `dist/`. `npm run preview` serve esse build localmente e,
na versão do Vite fixada no lockfile, herda o proxy `/v1` configurado no servidor
de desenvolvimento. `HARNESS_API_TARGET` também pode ser usado no preview.
Ao publicar somente `dist/`, configure roteamento **same-origin** de `/v1` para
a API e fallback das URLs de navegação para `index.html`. O backend atual não
oferece CORS para outro domínio.

## Estado e limites de rede

JWT em memória e `sessionStorage`, nunca em URL ou `localStorage`. Se o navegador
bloquear storage, a sessão funciona só em memória. Logout/401 removem sessão,
seleção e dados; requests anteriores são cancelados e resultados tardios são
ignorados. Papéis vêm de `/me`; o cliente não interpreta claims como autorização.
Nenhum token é registrado em logs ou telemetria.

O lint cobre TypeScript e TSX, incluindo regras de hooks/dependências. Funções
de lógica têm limite de 50 linhas; views declarativas TSX, 180 linhas.

As operações JSON têm timeout de 10 segundos; downloads, 30 segundos. Ambas têm cancelamento. Seguindo a
convenção da Fase 1 em `CLAUDE.md`, não há retry automático, backoff nem circuit
breaker: uma falha termina em erro recuperável, com retry explícito do usuário.
A tela troca para loading e desabilita envio repetido; não existe polling.
No Marketplace, busca/tipo/projeto reiniciam paginação e cancelam requests antigos.
O cursor da API permanece opaco e só em memória; páginas são deduplicadas por nome
único do pacote. Falha incremental preserva os itens já carregados. A lista é
consultada novamente ao retornar do pacote, preservando os filtros da URL.
`correlation_id` de Problem JSON fica acessível em “Informações para suporte”.
A lista de projetos respeita o limite de até 100 da API, que não tem cursor.
O plano retorna opcionais; a página do projeto renderiza o baseline fixado e oferece
navegação aos complementos no Marketplace.

## Organização e identidade visual

- `src/api`: client HTTP compartilhado e tipos gerados.
- `src/app`: sessão, navegação pelo History API e ciclo de requests.
- `src/pages`: login, workspace, composição do projeto, Marketplace e pacote.
- `src/components`: shell e primitives reaproveitadas do protótipo.
- `src/styles`: tokens, layout original e adaptação responsiva.
- `src/test`: fixtures exclusivas dos testes; não fazem parte do fluxo do produto.

A marca Smart Harness, o shell, os cartões e a paleta do protótipo foram
preservados: azul escuro `#002233`, cyan `#00DBFF`, mint `#00FFD4` e lime `#D9FF65`.
Telas e dados simulados futuros ficaram fora desta entrega. Não há dependência
adicional de runtime além de React e Lucide; as novas dependências são de teste
e geração de tipos.

Leitores de tela e Safari/Firefox não foram verificados automaticamente. Testes
DOM e build não substituem validação visual/responsiva em navegador.

Referências técnicas consultadas em 21/10/2026:

- [openapi-typescript: Node API](https://openapi-ts.dev/node)
- [Vite: proxy do servidor](https://vite.dev/config/server-options#server-proxy)
- [Vitest: configuração](https://vitest.dev/guide/)
- [React Testing Library: setup](https://testing-library.com/docs/react-testing-library/setup/)

Referências de download consultadas em 21/10/2026:

- [Web Crypto: digest SHA-256](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest)
- [Liberação de object URLs](https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static)

## Tokens pessoais (#28)

Abra **Meus tokens** no perfil. A listagem usa JWT e paginação por cursor da API.
Crie um nome de até 100 caracteres: o segredo aparece uma única vez. O botão de
cópia confirma somente quando o clipboard aceita; em falha, seleciona o texto
para cópia manual. **Fechar segredo**, navegar ou sair remove a exibição; o segredo
não é colocado no storage, URL ou logs. A área de transferência pertence ao sistema;
apague seu conteúdo depois de usá-lo no prompt seguro do terminal.

**Revogar** mostra nome e identificador antes da confirmação. A lista só é relida
após a API confirmar; erro preserva o item. Uma criação cuja resposta se perde pode
ter sido processada: confira a lista e revogue o item antes de tentar outra vez.

Roteiro integrado: criar um token, usar `Authorization: Bearer` em
`GET /v1/projects/investimentos-api/setup-plan` sem colocar o segredo na URL nem
registrar o header; revogar pelo frontend e repetir a mesma leitura, esperando 401.
Saia e entre com outra conta: os itens anteriores não devem aparecer. Em viewport
estreito, use Tab/Enter para criar, fechar e cancelar/confirmar revogação.

## Preparação real (#29)

A página de cada projeto mostra o baseline fixado e instruções para a CLI entregue
em #10: `harness setup '<slug>' --api-url '<url>'`, `harness doctor` e `harness sync`.
O setup consulta novamente o plano atual da API; uma alteração posterior ao plano
exibido exige recarregar a página para comparar a composição. O browser não recebe
estado da instalação local. Nenhum clique conclui a preparação.

`HARNESS_PUBLIC_API_URL` configura a URL sugerida para o terminal. Configure-a
explicitamente quando o proxy usa endereço interno (por exemplo, um hostname de
Docker). Sem ela, usa `HARNESS_API_TARGET` ou `http://127.0.0.1:8080`; a UI recusa
HTTP fora de loopback, credenciais, query e fragmento. O usuário pode corrigir a URL
no campo antes de copiar. Esses valores públicos nunca devem conter credenciais.
O proxy `/v1` do Vite não é apresentado como endereço de API para o terminal.

No primeiro setup, crie o token em **Meus tokens** e cole-o no prompt sem eco, sem
variável exportada nem segredo no comando. A CLI guarda-o em `~/.claude/settings.json`
com permissões restritas; usa-o nos comandos seguintes. A UI só lista complementos;
para instalá-los use `--include-optional nome,outro`. A paginação continua com o
cursor opaco de `setup-plan.optional.next_cursor` em `/v1/marketplace?project=...`.

Roteiro: abra Investimentos, confira o pin e copie o comando; a mensagem confirma
somente cópia. Em ambiente isolado, execute setup e doctor seguindo a tela. Confira
no terminal os arquivos/plugins aplicados e as linhas `ok`/`FAIL` com `fix:`. Execute
sync e confira o resultado no terminal. Volte à UI: ela não declara instalado nem
conectado. Troque de projeto/conta, force falha de rede ou acesso e confirme que os
comandos do projeto anterior somem. Teste larguras 390, 768 e 1440 e navegação Tab.
