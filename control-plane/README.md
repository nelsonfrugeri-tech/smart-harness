# control-plane

API do Smart Harness em Node/TypeScript: login local, memberships por squad, SQLite com migrations e endpoints operacionais. O Node 24 executa o TypeScript direto, sem etapa de build.

```bash
npm ci
npm run check   # tsc, eslint e vitest
APP_ENV=local JWT_SECRET=local-only-secret-change-me-0123456789 npm start   # 127.0.0.1:8080, banco em data/
APP_ENV=local JWT_SECRET=local-only-secret-change-me-0123456789 npm run seed
```

Pelo compose (a partir da raiz): `cp .env.example .env && make up && make seed`.

## Endpoints

| Método e caminho | Autenticação | Resposta |
| --- | --- | --- |
| `GET /healthz` | não | `{"status":"ok"}` se o processo responde |
| `GET /readyz` | não | `{"status":"ready"}` se o banco responde; senão 503 |
| `GET /metrics` | não | métricas Prometheus (processo e `http_request_duration_seconds`) |
| `POST /v1/auth/dev-login` `{email}` | não | `{access_token, token_type, expires_in}`; a rota só existe com `APP_ENV=local` |
| `GET /v1/me` | Bearer | `{user, memberships[{tenant, role}]}` |

```bash
JWT=$(curl -s -X POST 127.0.0.1:8080/v1/auth/dev-login -H 'content-type: application/json' \
  -d '{"email":"dev@smart-harness.local"}' | jq -r .access_token)
curl -s 127.0.0.1:8080/v1/me -H "Authorization: Bearer $JWT"
```

Erros usam `application/problem+json` (RFC 9457): `{type, title, status, code, detail?, correlation_id, errors?}`. `type` é `about:blank`; o cliente decide pelo `code`. Cada resposta traz o header `x-correlation-id`, que também aparece em todo log (campo `correlation_id`). Se a requisição enviar um `x-correlation-id` válido, a API o reaproveita.

## Autorização

- O JWT (HS256, 1 h) carrega só o id do usuário. Tenants e papéis (ADMIN, DEV) são lidos do banco a cada requisição: remover uma membership corta o acesso na requisição seguinte, com o mesmo token.
- Todo SQL fica em `src/db/repos/`. Funções que leem dados de tenant recebem o `Scope` do usuário (ids dos tenants dele) e filtram por ele com `tenant_id IN (SELECT value FROM json_each(?))`. Sem scope, a função lança erro; com scope vazio, não retorna nada.
- Recurso de outro tenant e recurso inexistente respondem o mesmo 404.
- Exceções explícitas: `repos/identity.ts` filtra pelo id do próprio usuário, porque é ele que monta o scope; `repos/seed.ts` contém escritas de sistema usadas só pelo seed local. Fora de `repos/`, só há SQL de infraestrutura: pragmas e ping em `db/database.ts` e a tabela `schema_migrations` em `db/migrate.ts`.

## Banco e migrations

- SQLite em `DATABASE_PATH` (no container, `/data/control-plane.sqlite`, no volume `sqlite-data`). `make down && make up` preserva o banco.
- Migrations em `migrations/NNNN_name.sql`, aplicadas em ordem no startup da API, cada uma numa transação. A tabela `schema_migrations` guarda versão, arquivo e sha256. Se um arquivo já aplicado mudar ou sumir, a API não sobe. Para mudar o schema, crie uma migration nova.
- O seed (`seed/`) só roda com `APP_ENV=local` e é idempotente: tenants `investimentos`, `conta` e `cartoes`, um projeto por tenant, `admin@smart-harness.local` (ADMIN nos três), `dev@smart-harness.local` (DEV em investimentos e conta) e `dev.cartoes@smart-harness.local` (DEV em cartoes).

## Configuração

| Variável | Padrão | Uso |
| --- | --- | --- |
| `APP_ENV` | `production` | `local` habilita dev-login e seed |
| `JWT_SECRET` | obrigatório | chave HS256, mínimo de 32 caracteres |
| `DATABASE_PATH` | `data/control-plane.sqlite` | arquivo SQLite (`:memory:` nos testes) |
| `TOKEN_TTL_SECONDS` | `3600` | validade do JWT |
| `HOST`, `PORT`, `LOG_LEVEL` | `127.0.0.1`, `8080`, `info` | servidor e logs |

## Estrutura

```text
migrations/          SQL numerado
seed/                dados de exemplo locais (npm run seed)
src/main.ts          startup: config, banco, migrations, HTTP
src/config.ts        leitura e validação do ambiente
src/domain/          tipos de acesso: User, Tenant, Role, Scope, Principal
src/db/              conexão, migrator e repos/ (todo o SQL)
src/http/            servidor, problem+json, autenticação, métricas e rotas
```

A imagem (`Dockerfile`, build a partir da raiz) compila o CLI `harness` em Go e o instala em `/usr/local/bin`. Roda com usuário não root e monta o volume `sqlite-data` em `/data`.

## Dependências

- `fastify`: servidor HTTP consolidado, com validação de JSON Schema, logs JSON (pino) e `inject()` para testar rotas sem abrir porta.
- `better-sqlite3`: driver SQLite síncrono e maduro, com prepared statements e transações; traz binários prontos, inclusive para Alpine.
- `jose`: emissão e verificação de JWT sem dependências, mantida e auditada.
- `@prometheus-io/client`: cliente Prometheus oficial do Node (sucessor do `prom-client`), com métricas de processo prontas.
- `typescript`, `@types/node` e `@types/better-sqlite3`: checagem de tipos (`tsc`, sem emitir arquivos).
- `eslint`, `@eslint/js` e `typescript-eslint`: lint com as regras recomendadas para TypeScript.
- `vitest`: runner de testes com suporte nativo a TypeScript.
