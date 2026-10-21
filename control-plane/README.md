# control-plane

API do Smart Harness em Node/TypeScript: login local, memberships por squad, SQLite com migrations, Marketplace, setup-plan, download de pacotes e endpoints operacionais. O Node 24 executa o TypeScript direto, sem etapa de build. O contrato HTTP está em [`openapi.json`](openapi.json).

```bash
npm ci
npm run check   # tsc, eslint e vitest
APP_ENV=local JWT_SECRET=local-only-secret-change-me-0123456789 npm start   # 127.0.0.1:8080, banco em data/
APP_ENV=local JWT_SECRET=local-only-secret-change-me-0123456789 npm run seed
```

Fora do compose, a API também precisa de um S3 (variáveis `S3_*`). Pelo compose (a partir da raiz): `cp .env.example .env && make up && make seed`.

## Endpoints

| Método e caminho | Autenticação | Resposta |
| --- | --- | --- |
| `GET /healthz` | não | `{"status":"ok"}` se o processo responde |
| `GET /readyz` | não | `{"status":"ready"}` se o banco responde; senão 503 |
| `GET /metrics` | não | métricas Prometheus (processo e `http_request_duration_seconds`) |
| `POST /v1/auth/dev-login` `{email}` | não | `{access_token, token_type, expires_in}`; a rota só existe com `APP_ENV=local` |
| `GET /v1/me` | Bearer | `{user, memberships[{tenant, role}]}` |
| `GET /v1/workspace` | Bearer | `{user, projects[{slug, name, description, tenant, counts, baseline}]}`, até 100 projetos |
| `GET /v1/marketplace?kind=&project=&q=&cursor=&limit=` | Bearer | `Page<PluginItem>`: plugins visíveis em ordem de nome, cada um com a última versão visível |
| `GET /v1/plugins/{name}` | Bearer | `PluginItem` |
| `GET /v1/plugins/{name}/versions?cursor=&limit=` | Bearer | `Page<PluginVersion>`, da mais nova para a mais antiga |
| `GET /v1/plugins/{name}/versions/{version}/archive` | Bearer | o tar.gz, com o digest no header `x-package-digest` |
| `GET /v1/projects/{slug}/setup-plan` | Bearer | `{project, gateway{url}, baseline[], optional{items, next_cursor}}`, sem token nem segredo |

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
- Exceções explícitas: `repos/identity.ts` filtra pelo id do próprio usuário, porque é ele que monta o scope; `repos/seed.ts` contém escritas de sistema usadas só pelo seed local. Fora de `repos/`, só há SQL de infraestrutura: pragmas e ping em `db/database.ts` e a tabela `schema_migrations` em `db/migrate.ts`.

## Banco e migrations

- SQLite em `DATABASE_PATH` (no container, `/data/control-plane.sqlite`, no volume `sqlite-data`). `make down && make up` preserva o banco.
- Migrations em `migrations/NNNN_name.sql`, aplicadas em ordem no startup da API, cada uma numa transação. A tabela `schema_migrations` guarda versão, arquivo e sha256. Se um arquivo já aplicado mudar ou sumir, a API não sobe. Para mudar o schema, crie uma migration nova.
- O seed (`seed/`) só roda com `APP_ENV=local` e é idempotente: tenants `investimentos`, `conta` e `cartoes`, um projeto por tenant, `admin@smart-harness.local` (ADMIN nos três), `dev@smart-harness.local` (DEV em investimentos e conta) e `dev.cartoes@smart-harness.local` (DEV em cartoes).

## Marketplace e pacotes

- `plugins` (dono: uma squad; nome único na organização), `plugin_versions` (versão, `visibility`, `digest`, tamanho), `components` (agentes, skills e MCPs de cada versão) e `project_baseline` (versão fixada por plugin em cada projeto). Triggers impedem `UPDATE` e `DELETE` em versões e componentes: versões são imutáveis.
- O banco guarda só o digest (`sha256:<hex>` do tar.gz) e o tamanho. O arquivo fica no object storage, na chave `packages/sha256-<hex>.tar.gz` do bucket `packages`. Como o nome é o hash, gravar o mesmo conteúdo de novo não cria outro objeto. Ao ler, a API confere o hash: um objeto alterado responde 500, nunca um arquivo corrompido.
- Localmente, o storage é o MinIO do compose (volume `minio-data`). Em produção, é o S3, sem mudar código: basta não definir `S3_ENDPOINT`. A API cria o bucket no startup, e o `/readyz` também verifica o bucket. Cada chamada ao S3 faz uma tentativa só, com timeouts explícitos (2 s para conectar, 30 s por requisição) e sem retry.
- A imagem do MinIO é a da Chainguard (`cgr.dev/chainguard/minio`), fixada por digest, porque a imagem `minio/minio` deixou de ser publicada.

### Publicação em dois passos (`src/domain/publish.ts`)

1. `prepareVersion(harness, dir)`, assíncrono: chama `harness validate <dir> --json`; depois, numa cópia do diretório, `harness generate <dir> --target claude-code` e `harness pack <dir> -o <file>`. Confere que o digest impresso pelo `pack` é o sha256 do arquivo e lê o manifesto (`plugin.json`, pastas de `skills/`, arquivos de `dev.smartharness/agents/` e servidores de `mcp.json`). Não grava nada.
2. `persistVersion(...)`: só ADMIN da squad dona publica. Confere o digest contra os bytes (um byte alterado impede a publicação), grava o arquivo no storage e, depois, a versão no banco, numa transação síncrona. Se o banco falhar, o arquivo fica sem versão e é reaproveitado quando o mesmo conteúdo for publicado. Republicar a mesma versão com o mesmo digest não muda nada; com outro digest, falha.

O `HarnessClient` é uma interface. `src/harness/cli-client.ts` roda o binário com `execFile`, sem shell e com timeout; os testes usam um fake. A aprovação (#16) usa só o segundo passo.

### Seed do Marketplace

`npm run seed:marketplace` (chamado por `make seed`, depois de `npm run seed`) publica como `admin@smart-harness.local`:

| Plugin | Versões | Squad dona | Visibilidade | Pacote base de |
| --- | --- | --- | --- | --- |
| `investimentos-base` | 1.0.0, 1.1.0 | investimentos | squad | `investimentos-api` (1.1.0) |
| `conta-base` | 1.0.0 | conta | squad | `conta-digital` |
| `cartoes-base` | 1.0.0 | cartoes | squad | `cartoes-app` |
| `code-review` | 1.0.0 | cartoes | organization | `cartoes-app` |

Assim, `dev@smart-harness.local` (investimentos e conta) vê `code-review` e recebe 404 em `cartoes-base`. Os pacotes são fixtures já geradas e empacotadas (tar.gz reproduzível) em `seed/packages/`. O seed calcula o digest em Node e chama `persistVersion`. Quando o engine do `harness` (#9) entrar, o seed passa a montar os pacotes com `prepareVersion` a partir das fontes.

## Configuração

| Variável | Padrão | Uso |
| --- | --- | --- |
| `APP_ENV` | `production` | `local` habilita dev-login e seed |
| `JWT_SECRET` | obrigatório | chave HS256, mínimo de 32 caracteres |
| `DATABASE_PATH` | `data/control-plane.sqlite` | arquivo SQLite (`:memory:` nos testes) |
| `TOKEN_TTL_SECONDS` | `3600` | validade do JWT |
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
  TEST_S3_SECRET_ACCESS_KEY=<S3_SECRET_ACCESS_KEY> npx vitest run src/storage
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
