# control-plane

API do Smart Harness em Node/TypeScript: login local, memberships por squad, SQLite com migrations, Marketplace, setup-plan, download de pacotes, token do gateway e endpoints operacionais. O Node 24 executa o TypeScript direto, sem etapa de build. O contrato HTTP está em [`openapi.json`](openapi.json).

```bash
npm ci
npm run check   # tsc, eslint e vitest
APP_ENV=local JWT_SECRET=local-only-secret-change-me-0123456789 npm start   # 127.0.0.1:8080, banco em data/
APP_ENV=local JWT_SECRET=local-only-secret-change-me-0123456789 npm run seed
```

Fora do compose, a API também precisa de um S3 (variáveis `S3_*`). Pelo compose (a partir da raiz): `cp .env.example .env && make up && make seed`.

## Instalador público

O Docker compila os quatro binários e `SHA256SUMS`, e inclui `cli/install.sh` em
`/app/install`. `INSTALLER_VERSION` (padrão `v0.2.3`) controla nomes e versão dos
binários distribuídos; o `HARNESS_VERSION` do engine pode continuar como `dev`.
Use o mesmo `INSTALLER_VERSION` no build e no runtime, como faz o Compose.

`PUBLIC_API_URL` (padrão `http://127.0.0.1:8080`; no Compose acompanha `API_PORT`)
é a origem usada pelo script. Aceita HTTPS ou HTTP loopback, sem credenciais,
query ou fragmento. Headers Host/Forwarded não alteram o script. Os valores são
literais shell com escaping; não incluem segredo.

Fora do Docker, configure `INSTALLER_ASSETS_DIR` explicitamente com `install.sh`,
os quatro `harness-v0.2.3-{darwin,linux}-{arm64,amd64}` e `SHA256SUMS`. Ausência,
template inválido ou symlink responde `503 installer_unavailable`; não há
fallback de download externo. Somente os cinco nomes de assets são públicos.
As respostas usam `Cache-Control: no-store` e os assets são transmitidos em stream.

## Endpoints

| Método e caminho | Autenticação | Resposta |
| --- | --- | --- |
| `GET /install` | não | script POSIX com origem e versão configuradas; 503 se indisponível |
| `GET /install/{filename}` | não | quatro binários macOS/Linux ARM64/x64 e `SHA256SUMS`; 404 para nomes fora da lista, 503 para asset ausente |
| `GET /healthz` | não | `{"status":"ok"}` se o processo responde |
| `GET /readyz` | não | `{"status":"ready"}` se o banco responde; senão 503 |
| `GET /metrics` | não | métricas Prometheus (processo e `http_request_duration_seconds`) |
| `POST /v1/auth/dev-login` `{email}` | não | `{access_token, token_type, expires_in}`; a rota só existe com `APP_ENV=local` |
| `GET /v1/me` | JWT ou token do gateway | `{user, memberships[{tenant, role}]}` |
| `GET /v1/workspace` | JWT ou token do gateway | `{user, projects[{slug, name, description, tenant, counts, baseline}]}`, até 100 projetos |
| `GET /v1/marketplace?type=&kind=&project=&q=&cursor=&limit=` | JWT ou token do gateway | `Page<PluginItem>`: plugins visíveis em ordem de nome, cada um com a última versão visível |
| `GET /v1/plugins/{name}` | JWT ou token do gateway | `PluginItem` |
| `GET /v1/plugins/{name}/versions?cursor=&limit=` | JWT ou token do gateway | `Page<PluginVersion>`, da mais nova para a mais antiga |
| `GET /v1/plugins/{name}/versions/{version}/archive` | JWT ou token do gateway | o tar.gz, com o digest no header `x-package-digest` |
| `GET /v1/projects/{slug}/setup-plan` | JWT ou token do gateway | `{project, gateway{url}, baseline[], optional{items, next_cursor}}`, sem token nem segredo |
| `POST /v1/me/gateway-tokens` `{name}` | só JWT | `201 {id, name, token, created_at, expires_at}`; o `token` aparece só aqui |
| `GET /v1/me/gateway-tokens?cursor=&limit=` | só JWT | `Page<{id, name, created_at, expires_at, revoked_at}>`, do mais novo para o mais antigo, sem valor nem hash |
| `DELETE /v1/me/gateway-tokens/{id}` | só JWT | `204`; revogar de novo também responde `204`; token de outro usuário responde `404` |
| `PUT /v1/projects/{slug}/baseline/{plugin}` `{version}` | só JWT, ADMIN da squad do projeto | `{plugin, version}`; fixa a versão no pacote base (rollback = versão mais antiga) |
| `POST /v1/drafts` `{tenant, visibility?, files[{path, content}]}` | só JWT, membro da squad | `201 Draft` com `ETag: "<revision>"` |
| `GET /v1/drafts?cursor=&limit=` | só JWT | `Page<DraftSummary>`: os rascunhos do próprio usuário, sem conteúdo |
| `GET /v1/drafts/{id}` | só JWT, autor; ADMIN da squad só com a revisão atual enviada | `Draft` com `ETag` |
| `PATCH /v1/drafts/{id}` `{files?, visibility?}` + `If-Match` | só JWT, autor | `Draft`; sem `If-Match` → `428`; revisão antiga → `412` |
| `POST /v1/drafts/{id}/validate` | só JWT, autor | `{valid, digest, findings[]}` |
| `GET /v1/drafts/{id}/archive` | JWT ou token do gateway, autor; ADMIN da squad só com a revisão atual enviada | o tar.gz validado, com `x-package-digest`; sem validação → `409` |
| `POST /v1/drafts/{id}/submit` | só JWT, autor | `201 Contribution` |
| `GET /v1/contributions?view=mine\|review&cursor=&limit=` | só JWT | `Page<Contribution>` |
| `GET /v1/contributions/{id}` | só JWT, autor ou ADMIN da squad | `Contribution` |
| `POST /v1/contributions/{id}/approve` `{digest, comment?}` | só JWT, ADMIN da squad que não é o autor | `Contribution` publicada |

```bash
JWT=$(curl -s -X POST 127.0.0.1:8080/v1/auth/dev-login -H 'content-type: application/json' \
  -d '{"email":"dev@smart-harness.local"}' | jq -r .access_token)
curl -s 127.0.0.1:8080/v1/me -H "Authorization: Bearer $JWT"
curl -s "127.0.0.1:8080/v1/marketplace?kind=skill" -H "Authorization: Bearer $JWT" | jq '.items[].plugin.name'
curl -s 127.0.0.1:8080/v1/projects/investimentos-api/setup-plan -H "Authorization: Bearer $JWT"
curl -s -D - -o pkg.tar.gz 127.0.0.1:8080/v1/plugins/investimentos-base/versions/1.1.0/archive \
  -H "Authorization: Bearer $JWT" | grep -i x-package-digest
shasum -a 256 pkg.tar.gz   # igual ao header, sem o prefixo sha256:
```

Listas usam paginação por cursor: `?limit=` (1–100, padrão 20) e `?cursor=`, com resposta `{items, next_cursor}`. Na última página, `next_cursor` é `null`. Cursor inválido responde 400 `invalid_cursor`.

Erros usam `application/problem+json` (RFC 9457): `{type, title, status, code, detail?, correlation_id, errors?}`. `type` é `about:blank`; o cliente decide pelo `code`. Cada resposta traz o header `x-correlation-id`, que também aparece em todo log (campo `correlation_id`). Se a requisição enviar um `x-correlation-id` válido, a API o reaproveita.

## Autorização

- O JWT (HS256, 1 h) carrega só o id do usuário. Tenants e papéis (ADMIN, DEV) são lidos do banco a cada requisição: remover uma membership corta o acesso na requisição seguinte, com o mesmo token.
- Todo SQL fica em `src/db/repos/`. Funções que leem dados de tenant recebem o `Scope` do usuário (ids dos tenants dele) e filtram por ele com `tenant_id IN (SELECT value FROM json_each(?))`. Sem scope, a função lança erro; com scope vazio, não retorna nada.
- Recurso de outro tenant e recurso inexistente respondem o mesmo 404.
- Visibilidade no Marketplace: uma versão é visível se o plugin é de uma squad do usuário, ou se a versão é `organization` e o usuário tem ao menos uma membership. Sem membership, o usuário não vê nada. A regra fica num único trecho SQL em `repos/marketplace.ts`, usado por todas as leituras.
- Com `?project=` e no setup-plan, vale a visão da squad dona do projeto, e não a soma das squads do usuário. O `?project=` lista os opcionais do projeto: o que a squad vê, menos o pacote base.
- Exceções explícitas: `repos/identity.ts` e `repos/gateway-tokens.ts` filtram pelo id do próprio usuário: o primeiro monta o scope, e o token do gateway pertence ao usuário, não a um tenant; `repos/seed.ts` contém escritas de sistema usadas só pelo seed local. Fora de `repos/`, só há SQL de infraestrutura: pragmas e ping em `db/database.ts` e a tabela `schema_migrations` em `db/migrate.ts`.

## Token do gateway

O dev configura um único segredo, o token do gateway, para MCPs, modelos e o CLI `harness`.

- Formato: `shg_` seguido de 32 bytes aleatórios em base64url (43 caracteres). Validade: `GATEWAY_TOKEN_TTL_DAYS` (padrão 90 dias).
- A tabela `gateway_tokens` guarda só o sha256 do token inteiro (com o prefixo), em hex minúsculo. O valor aparece uma vez, na resposta do `POST`, com `Cache-Control: no-store`. A listagem, os logs e a auditoria (`gateway_token.created` e `gateway_token.revoked`) nunca levam o valor nem o hash.
- Regra de validação, a mesma que o Agent Gateway (#13) aplica: o token tem o formato acima, e `sha256(token)` está numa linha com `revoked_at IS NULL` e `expires_at` no futuro. O SQL fica em `ACTIVE_GATEWAY_TOKEN_SQL` (`src/db/repos/gateway-tokens.ts`); o formato e o hash, em `src/domain/gateway-token.ts`.
- Autorização por rota: o token vale só nas rotas registradas com `config: GATEWAY_TOKEN_ALLOWED` (as leituras de produto da tabela acima). Um hook `onRequest` recusa o token em qualquer outra rota, inclusive inexistente, antes da validação do corpo: escrita e gerenciamento de tokens respondem `401 gateway_token_not_allowed`, nunca 400. O `authenticate()` confere a mesma regra de novo. Rota nova nasce fechada para o token.
- O token resolve o usuário. Tenants e papéis continuam vindo das memberships a cada requisição.

```bash
SHG=$(curl -s -X POST 127.0.0.1:8080/v1/me/gateway-tokens -H "Authorization: Bearer $JWT" \
  -H 'content-type: application/json' -d '{"name":"notebook"}' | jq -r .token)
curl -s 127.0.0.1:8080/v1/projects/investimentos-api/setup-plan -H "Authorization: Bearer $SHG"
```

## Banco e migrations

- SQLite em `DATABASE_PATH` (no container, `/data/control-plane.sqlite`, no volume `sqlite-data`). `make down && make up` preserva o banco.
- Migrations em `migrations/NNNN_name.sql`, aplicadas em ordem no startup da API, cada uma numa transação. A tabela `schema_migrations` guarda versão, arquivo e sha256. Se um arquivo já aplicado mudar ou sumir, a API não sobe. Para mudar o schema, crie uma migration nova.
- O seed (`seed/`) só roda com `APP_ENV=local` e é idempotente: tenants `investimentos`, `conta` e `cartoes`, um projeto por tenant, `admin@smart-harness.local` (ADMIN nos três), `dev@smart-harness.local` (DEV em investimentos e conta) e `dev.cartoes@smart-harness.local` (DEV em cartoes).

## Marketplace e pacotes

- `plugins` (dono: uma squad; nome único na organização), `plugin_versions` (versão, `visibility`, `digest`, tamanho), `components` (agentes, skills e MCPs de cada versão) e `project_baseline` (versão fixada por plugin em cada projeto). Triggers impedem `UPDATE` e `DELETE` em versões e componentes: versões são imutáveis.
- O banco guarda só o digest (`sha256:<hex>` do tar.gz) e o tamanho. O arquivo fica no object storage, na chave `packages/sha256-<hex>.tar.gz` do bucket `packages`. Como o nome é o hash, gravar o mesmo conteúdo de novo não cria outro objeto. Ao ler, a API confere o hash: um objeto alterado responde 500, nunca um arquivo corrompido.
- Localmente, o storage é o MinIO do compose (volume `minio-data`). Em produção, é o S3, sem mudar código: basta não definir `S3_ENDPOINT`. A API cria o bucket no startup, e o `/readyz` também verifica o bucket. Cada chamada ao S3 faz uma tentativa só, com timeouts explícitos (2 s para conectar, 30 s por requisição) e sem retry.
- A imagem do MinIO é a da Chainguard (`cgr.dev/chainguard/minio`), fixada por digest, porque a imagem `minio/minio` deixou de ser publicada.

Cada `PluginItem` inclui `type` e `keywords`. O tipo é calculado por versão: somente MCPs → `connector`; somente skills → `skill`; qualquer outra composição (inclusive vazia) → `agent`. `type` aceita esses três valores, combina com `kind`, `q` e `project`, e responde 400 para valores desconhecidos. `q` também pesquisa substrings das tags, sem interpretar `%` e `_` como wildcards. O setup-plan usa a mesma representação, respeitando a versão fixada.

A migration `0008_plugin_keywords.sql` adiciona tags por versão com padrão `[]`. Não retroalimenta tags das versões existentes nem altera seus archives. Na publicação, o relatório v2 de `harness validate --json` fornece descrição e tags; relatórios antigos sem esses campos usam o manifesto como fallback.

### Publicação em dois passos (`src/domain/publish.ts`)

1. `prepareVersion(harness, dir)`, assíncrono: chama `harness validate <dir> --json`; depois, numa cópia do diretório, `harness generate <dir> --target claude-code` e `harness pack <dir> -o <file>`. Confere que o digest impresso pelo `pack` é o sha256 do arquivo e lê o manifesto (`plugin.json`, pastas de `skills/`, arquivos de `dev.smartharness/agents/` e servidores de `mcp.json`). Não grava nada.
2. `persistVersion(...)`: só ADMIN da squad dona publica. Confere o digest contra os bytes (um byte alterado impede a publicação), grava o arquivo no storage e, depois, a versão no banco, numa transação síncrona. Se o banco falhar, o arquivo fica sem versão e é reaproveitado quando o mesmo conteúdo for publicado. Republicar a mesma versão com o mesmo digest não muda nada; com outro digest, falha.

O `HarnessClient` é uma interface. `src/harness/cli-client.ts` roda o binário com `execFile`, sem shell e com timeout; os testes usam um fake. A API usa o `harness` do `PATH` (no container, `/usr/local/bin/harness`).

## Contribuição: rascunho, validação, aprovação e rollback

```text
POST /v1/drafts ──► PATCH (If-Match) ──► POST /validate ──► harness draft pull ──► POST /submit ──► POST /approve
                       │                    │ grava o tar.gz no storage                                │ uma transação SQLite
                       └ invalida a         │ pelo digest do `pack`                                    └ versão + contribuição + auditoria
                         contribuição enviada
```

- **Rascunho** (`drafts`, migration `0006`): os arquivos ficam no SQLite como texto (`files`, JSON). Só o autor vê até enviar. Um ADMIN da squad lê o detalhe e o archive só enquanto existe contribuição `submitted` da revisão atual; antes do envio e depois de uma edição, recebe 404, como se o rascunho não existisse. `visibility` é `squad` (padrão) ou `organization`. Toda edição sobe a `revision`, que vai no `ETag`. O `PATCH` exige `If-Match`.
- **Caminhos e limites**: cada caminho é relativo, em POSIX, sem `/` no início, letra de drive, `\`, NUL ou segmento vazio, `.` ou `..`; não pode repetir nem ficar abaixo de outro arquivo. Limites: 500 arquivos, 1 MiB por arquivo, 4 MiB no total e 6 MiB de corpo (`bodyLimit` de `POST` e `PATCH`). A checagem roda no `POST`/`PATCH` e de novo no `validate`, antes da primeira escrita: caminho inválido responde `400 invalid_path` sem criar arquivo. `src/domain/drafts.ts` também confere que o caminho resolvido fica dentro do diretório temporário.
- **Validar** (`POST /v1/drafts/{id}/validate`): grava os arquivos num diretório temporário novo, roda `harness validate`, `generate --target claude-code` e `pack` (o mesmo passo de `prepareVersion`) e grava o tar.gz no object storage pelo digest do `pack`. Por isso o arquivo vai para o storage no `validate`, e não no `submit`: o `harness draft pull` precisa dos bytes antes do envio. O resultado só é gravado se a revisão não mudou (`UPDATE ... WHERE revision = ?`); senão, `409 draft_changed`. O digest guardado é o do `pack` depois do `generate`, não o `digest` do relatório do `validate` (que é da árvore crua).
- **Testar**: `harness draft pull <id>` baixa `GET /v1/drafts/{id}/archive` (aceita o token do gateway) e confere o digest.
- **Enviar** (`contributions`, migration `0007`): o `submit` só confere que existe validação da revisão atual e fixa digest, tamanho e manifesto. Uma contribuição `submitted` por rascunho (índice único parcial). Editar o rascunho, na mesma transação do `PATCH`, muda a contribuição para `invalidated`.
- **Aprovar**: um ADMIN da squad que não é o autor envia o `digest` que revisou. A aprovação é uma única transação síncrona (`db.transaction(...).immediate()` em `src/domain/contributions.ts`): relê a contribuição, confere estado e digest, grava plugin, versão e componentes (`insertPublishedVersion`), marca a contribuição como `published` e grava a auditoria `contribution.approved`. Não chama o binário nem o storage. Qualquer falha desfaz tudo. O banco também recusa `reviewer_id = author_id`.
- **Pacote base e rollback**: `PUT /v1/projects/{slug}/baseline/{plugin}` `{version}` fixa a versão; rollback é fixar uma versão anterior. O setup-plan seguinte já traz a versão, e o `harness sync` a instala. Auditoria: `baseline.pinned`.
- O manifesto publicado usa `name`, `version` e `description` do `plugin.json` e os componentes do relatório do `harness validate`, nunca do corpo da requisição. Tipo do pacote e `keywords` ficam fora deste escopo.
- As rotas usam `/validate`, `/submit` e `/approve` em vez de `:validate`: no Fastify 5, `/:id::validate` e `/:id::submit` viram a mesma rota (`FST_ERR_DUPLICATED_ROUTE`).

```bash
JWT=$(curl -s -X POST 127.0.0.1:8080/v1/auth/dev-login -H 'content-type: application/json' -d '{"email":"dev@smart-harness.local"}' | jq -r .access_token)
ID=$(curl -s -X POST 127.0.0.1:8080/v1/drafts -H "Authorization: Bearer $JWT" -H 'content-type: application/json' -d @draft.json | jq -r .id)
curl -s -X POST "127.0.0.1:8080/v1/drafts/$ID/validate" -H "Authorization: Bearer $JWT" | jq '.valid, .digest'
```

### Seed do Marketplace

`npm run seed:marketplace` (chamado por `make seed`, depois de `npm run seed`) publica como `admin@smart-harness.local`:

| Plugin | Versões | Squad dona | Visibilidade | Pacote base de |
| --- | --- | --- | --- | --- |
| `investimentos-base` | 1.0.0, 1.1.0, 1.2.0, 1.2.1, 1.2.2 | investimentos | squad | `investimentos-api` (1.2.1) |
| `conta-base` | 1.0.0, 1.0.1 | conta | squad | `conta-digital` |
| `cartoes-base` | 1.0.0, 1.0.1 | cartoes | squad | `cartoes-app` |
| `code-review` | 1.0.0, 1.0.1 | cartoes | organization | `cartoes-app` |

| `github-connector` | 1.0.0 | investimentos | squad | opcional |

As últimas versões incluem tags. Os pins anteriores permanecem inalterados. `node marketplace/build-metadata-fixtures.mjs [caminho-do-harness]`, na raiz, reproduz as cinco novas fixtures com validação, geração e pack pelo engine real; recusa sobrescrever bytes diferentes da mesma versão. A versão nova de Conta também atualiza a URL MCP legada para o endpoint por projeto exigido pelo engine atual.

Assim, `dev@smart-harness.local` (investimentos e conta) vê `code-review` e recebe 404 em `cartoes-base`. Os pacotes são fixtures já geradas e empacotadas (tar.gz reproduzível) em `seed/packages/`. O seed calcula o digest em Node e chama `persistVersion`.

## Configuração

| Variável | Padrão | Uso |
| --- | --- | --- |
| `APP_ENV` | `production` | `local` habilita dev-login e seed |
| `JWT_SECRET` | obrigatório | chave HS256, mínimo de 32 caracteres |
| `DATABASE_PATH` | `data/control-plane.sqlite` | arquivo SQLite (`:memory:` nos testes) |
| `TOKEN_TTL_SECONDS` | `3600` | validade do JWT |
| `GATEWAY_TOKEN_TTL_DAYS` | `90` | validade de um token do gateway novo |
| `HOST`, `PORT`, `LOG_LEVEL` | `127.0.0.1`, `8080`, `info` | servidor e logs |
| `GATEWAY_PUBLIC_URL` | `http://127.0.0.1:8081` | URL do gateway enviada no setup-plan |
| `S3_ENDPOINT` | vazio (AWS S3) | endpoint S3 compatível; no compose, `http://minio:9000` |
| `S3_REGION`, `S3_BUCKET` | `us-east-1`, `packages` | região e bucket dos pacotes |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | vazio (cadeia padrão do SDK) | as duas ou nenhuma; no compose, as credenciais locais do `.env` |

## Estrutura

```text
openapi.json         contrato HTTP (OpenAPI 3.1), conferido contra as rotas nos testes
migrations/          SQL numerado
seed/                dados de exemplo locais (npm run seed, npm run seed:marketplace)
seed/packages/       pacotes de exemplo já empacotados (tar.gz)
src/main.ts          startup: config, banco, migrations, bucket, HTTP
src/config.ts        leitura e validação do ambiente
src/domain/          acesso (User, Scope, Principal), Marketplace e publicação em dois passos
src/db/              conexão, migrator e repos/ (todo o SQL)
src/storage/         pacotes no object storage (putPackage, getPackage)
src/harness/         cliente do binário harness (execFile)
src/http/            servidor, problem+json, autenticação, métricas, paginação e rotas
```

A imagem (`Dockerfile`, build a partir da raiz) compila o CLI `harness` em Go e o instala em `/usr/local/bin`. Roda com usuário não root e monta o volume `sqlite-data` em `/data`. O serviço `minio` guarda os pacotes no volume `minio-data`; `make down && make up` preserva os dois volumes.

Teste do storage contra um S3 real (opcional; cria e remove um bucket próprio):

```bash
TEST_S3_ENDPOINT=http://127.0.0.1:9000 TEST_S3_ACCESS_KEY_ID=<S3_ACCESS_KEY_ID> \
  TEST_S3_SECRET_ACCESS_KEY=<S3_SECRET_ACCESS_KEY> npx vitest run test/storage
```

## Dependências

- `fastify`: servidor HTTP consolidado, com validação de JSON Schema, logs JSON (pino) e `inject()` para testar rotas sem abrir porta.
- `better-sqlite3`: driver SQLite síncrono e maduro, com prepared statements e transações; traz binários prontos, inclusive para Alpine.
- `jose`: emissão e verificação de JWT sem dependências, mantida e auditada.
- `@aws-sdk/client-s3`: SDK oficial da AWS para S3; fala com o MinIO local e com o S3 de produção sem mudar código.
- `@prometheus-io/client`: cliente Prometheus oficial do Node (sucessor do `prom-client`), com métricas de processo prontas.
- `typescript`, `@types/node` e `@types/better-sqlite3`: checagem de tipos (`tsc`, sem emitir arquivos).
- `eslint`, `@eslint/js` e `typescript-eslint`: lint com as regras recomendadas para TypeScript.
- `vitest`: runner de testes com suporte nativo a TypeScript.
- `ajv` (dev): validador JSON Schema 2020-12; o teste de contrato valida as respostas reais contra os schemas do `openapi.json`.

## Instalação pessoal

Os comandos padrão `npm run seed` e `npm run seed:marketplace` preparam agora uma
base local sem projetos: perfil `dev@smart-harness.local`, cargo ilustrativo
`Software Engineer` e sete pacotes (cinco conectores e dois pacotes de skills).
O filtro Agentes permanece vazio. Os seeds e endpoints de projetos anteriores permanecem no
código para compatibilidade; não são executados pelo seed padrão.

Use um banco e bucket separados para a demo pessoal. O seed não apaga projetos,
publicações ou tokens existentes. Se um nome do catálogo já pertence a outro
tenant, o seed do marketplace interrompe antes de publicar e orienta usar outro
banco, preservando a propriedade anterior.

`GET /v1/me/setup-plan` autentica o token pessoal ou JWT e retorna `gateway.url` e
`optional.items/next_cursor`. Aceita `cursor`, `limit`, `type`, `kind` e `q`, com a
mesma visibilidade do marketplace, sem projeto nem baseline obrigatório. Sem
membership, a lista é vazia. `GET /v1/me` inclui `user.job_title` (string ou null),
um campo de apresentação que não altera permissões.

Somente `DEMO_GITHUB_REPO`, `DEMO_TRELLO_BOARD_ID` e `DEMO_NOTION_PAGE_IDS` alimentam
as permissões dos conectores pessoais do usuário DEV. Variável ausente remove as
concessões desse servidor no próximo seed. O token autentica o usuário; permissões
ficam em `user_gateway_permissions` e exigem a membership vigente do mesmo tenant.

## Origem dos pacotes

A listagem, o detalhe e o setup-plan incluem os campos opcionais `source` e
`related_project`. `source.kind` identifica a origem do pacote (`internal` ou
`open-source`); `internal` descreve autoria interna e não afirma licença
proprietária. `related_project` identifica separadamente o projeto atendido pelo
wrapper ou pelas skills, com `kind`, `name`, `repository_url` e licença opcional.
Ausência significa informação não estabelecida, inclusive em publicações legadas.

Os sete pacotes pessoais têm autoria interna. Graphify, deja-vu e md2poui têm
projetos relacionados open source. A licença desses projetos não é atribuída ao
pacote de integração. Os registros editoriais ficam em `plugins.catalog_metadata`
e podem ser atualizados pelo seed sem alterar versões, componentes ou arquivos
publicados. Não há inferência de origem pelo nome no frontend.

Links de repositório aceitam somente a raiz HTTPS de `github.com/owner/repository`,
sem credenciais, porta, query ou fragmento. Metadados inválidos são recusados na
escrita do seed; campos inválidos existentes também são omitidos nas respostas.

Fontes de licença verificadas em 22/10/2026:

- [Graphify v0.9.56: Apache-2.0](https://github.com/Graphify-Labs/graphify/blob/v0.9.56/LICENSE).
- [deja-vu v0.16.8: MIT](https://github.com/vshulcz/deja-vu/blob/v0.16.8/LICENSE).
- [TOTVS md2poui: MIT declarado no package.json, revisão f097b94](https://github.com/totvs/md2poui/blob/f097b94b0dd0dad367cdd7bb2f8312281a6ca90e/package.json).

## Publicação de pacotes pelo GitHub

O ADMIN cadastra `owner`, `repo`, `tenant_id` e `visibility` em `POST /v1/repositories`.
A tela lista os cadastros por `GET /v1/repositories` com `limit` e `cursor`.
`POST /v1/repositories/:id/sync` recebe `{ "tag": "v1.0.0" }` e importa uma Release
publicada com exatamente um asset `.tar.gz`. Gere a camada Claude Code antes de empacotar:
`harness generate package --target claude-code` e
`harness pack package -o agent-example-1.0.0.tar.gz`. O asset fica no GitHub; não há upload
para MinIO. A tag, com ou sem prefixo `v`, precisa corresponder ao `plugin.json`.

SQLite guarda catálogo, squad, visibilidade, versão, digest SHA-256, ID da Release, ID do
asset e commit resolvido da tag. Uma nova sincronização idêntica retorna `unchanged`.
Alterar origem ou conteúdo de uma versão publicada retorna `409`; publique outra versão.
A associação do asset ao commit registra a origem informada pela Release e pela tag:
ela não é uma prova de build reproduzível nem de revisão do código por PR.

O download continua em `/v1/plugins/:name/versions/:version/archive`, com a autorização
existente. Para versões novas, a API busca o asset pelo ID fixado, verifica tamanho e
SHA-256 e só então entrega os bytes. Assets alterados são recusados. Releases não precisam
ter o recurso de imutabilidade do GitHub ativado; a proteção local detecta alterações.
Instalação depende da disponibilidade do GitHub. Versões antigas continuam no S3.

Repositórios públicos funcionam sem credencial. `GITHUB_TOKEN`, opcional e somente no
servidor, permite acessar repositórios privados e usar a cota autenticada; conceda apenas
`Contents: read` nos repositórios que a plataforma deve publicar. Um ADMIN pode importar
conteúdo de qualquer repositório acessível a essa credencial para sua squad. O cadastro
não concede novas permissões no GitHub. A credencial nunca aparece no contrato nem segue
redirects para os hosts de download. Readiness e listagens não fazem chamadas ao GitHub.

Cada sincronização usa prazo total de 60 segundos nas chamadas GitHub, sem retry.
Downloads aceitam até três redirects HTTPS apenas para os hosts de assets do GitHub.
Metadados têm limite de 1 MiB; Releases com mais de 100 assets são recusadas.
O engine limita a extração a 2.000 arquivos, 5 MiB por arquivo e 50 MiB no total,
rejeitando links e caminhos inseguros. A validação compara a camada gerada e mantém os
bytes originais do asset. Extração, validação e geração têm timeout individual de 60 s.
O histograma HTTP existente registra duração e status das rotas, permitindo calcular p95.
Os testes do inspector compilam um engine temporário; Go deve estar disponível, como no
`make check` da raiz.

Referências verificadas em 22/10/2026:
[Releases](https://docs.github.com/en/rest/releases/releases),
[Release assets e download](https://docs.github.com/en/rest/releases/assets),
[Git references](https://docs.github.com/en/rest/git/refs) e
[annotated tags](https://docs.github.com/en/rest/git/tags).
