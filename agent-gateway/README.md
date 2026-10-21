# agent-gateway

Porta única do coding agent para MCPs e modelos, em Node/TypeScript. Hoje atende MCP em
`POST /mcp/projects/{project}/{server}`. O proxy de modelos fica na #15 e os backends reais (github, trello,
notion, project) na #14.

```bash
npm ci
npm run check   # tsc, eslint e vitest
npm start       # escuta em 127.0.0.1:8081 (HOST e PORT mudam isso)
```

O Node 24 executa o TypeScript direto, sem etapa de build. Os testes usam o schema, as migrations e o seed
reais do `control-plane/`; rode `npm ci` nos dois componentes antes (`make check` faz isso).

## Endpoint MCP

Streamable HTTP, **sem sessão**, com resposta em JSON. Cada `POST` é independente. `GET` e `DELETE` respondem 405.
O cliente envia `Authorization: Bearer shg_...` e `Accept: application/json, text/event-stream`.

As verificações rodam nesta ordem e param na primeira que falha:

| # | Verificação | Falha |
| --- | --- | --- |
| 1 | `Origin`, se presente, está em `ALLOWED_ORIGINS` | 403 |
| 2 | Token `shg_`: formato, hash sha256, não revogado, não expirado | 401 com `WWW-Authenticate: Bearer` |
| 3 | Projeto existe e pertence a um tenant (squad) do usuário | 404 (mesma resposta para projeto inexistente) |
| 4 | Servidor registrado | 404 |

A regra do token é a mesma da API (`ACTIVE_GATEWAY_TOKEN_SQL`). Um teste compara o texto da consulta com o do
`control-plane/` para o código não divergir sem aviso. Papel (ADMIN ou DEV) não muda o acesso: basta ser membro do tenant.

## Permissão por recurso

Cada projeto lista em `gateway_permissions` (migration `0004` do control-plane) os recursos que pode usar em cada
servidor: `(project_id, server, resource_type, resource_id)`. Exemplos: `github/repo`, `trello/board`, `notion/page`.

Um backend implementa `McpBackend { server; listTools(ctx); callTool(ctx, name, args) }` e é registrado por nome em
`main.ts`. Toda tool declara o recurso que usa (`access`):

| Tipo | Como o gateway decide |
| --- | --- |
| `resource` | `extract(args)` devolve o id do repositório, board ou página. `null`, ou id fora da lista do projeto: negado. |
| `search` | O backend recebe a lista permitida em `ctx.allowedResources` e busca só nela. Lista vazia: resultado vazio, sem chamar o backend. |
| sem `access` | Não aparece em `tools/list` e é negada em `tools/call`. |

Chamada negada vira resultado `isError: true`, é auditada como `denied` e **não chega ao backend**. Falha do backend vira
`isError: true` com texto genérico (a mensagem original pode conter argumentos) e auditoria `error`.

## Auditoria

Cada `tools/call` grava um evento `gateway.tool_call` em `audit_events` com `outcome` `ok`, `denied` ou `error`.
Acesso negado antes do `tools/call` (projeto de outra squad, servidor inexistente) grava `gateway.access_denied`.
Os detalhes têm só projeto, servidor, tool, resultado, motivo, tipo e id do recurso (ou a contagem, na busca). Nunca
valores de argumentos, resultados ou mensagens de erro. 401 e 403 não têm usuário confiável e ficam só no log.

**Decisão: o gateway escreve direto no mesmo SQLite.** O arquivo está em WAL com `busy_timeout` de 5 s, então um
escritor espera o outro. Um endpoint interno na API adicionaria uma credencial entre serviços, mais uma rota para
proteger e a dependência da API estar de pé para auditar. Em troca, o gateway conhece a tabela `audit_events`.
O gateway abre o arquivo duas vezes: leitura (`readonly`) para token, memberships, projetos e permissões, e
escrita só para o `INSERT` de auditoria. Falha ao auditar derruba a chamada com 500 (sem retry). Evidência:
`test/audit-concurrency.test.ts` roda dois processos (um grava como a API, outro como o gateway), 500 escritas cada, e
confere 1.000 linhas e `PRAGMA integrity_check` = `ok`. O arquivo é criado e migrado pela API; o gateway só abre
(`fileMustExist`) e no compose sobe depois da API saudável.

## Configuração

| Variável | Padrão | Uso |
| --- | --- | --- |
| `APP_ENV` | `production` | `local` registra o backend `echo` (só para teste). |
| `HOST`, `PORT` | `127.0.0.1`, `8081` | Endereço de escuta. |
| `DATABASE_PATH` | `data/control-plane.sqlite` | Arquivo SQLite da API (`/data/control-plane.sqlite` no compose). |
| `ALLOWED_ORIGINS` | vazio | Origens permitidas, separadas por vírgula. Vazio: toda requisição com `Origin` leva 403. Agentes de linha de comando não enviam `Origin`. |
| `MODEL_UPSTREAM_KEY` | vazio | Chave da organização no provedor de modelos (OpenRouter). Nunca chega ao dev nem aparece em log. Vazio: `POST /v1/messages` responde 503. |
| `MODEL_UPSTREAM_URL` | `https://openrouter.ai/api` | URL base do provedor, no formato da API Anthropic. Trocar de provedor não muda nada na máquina do dev. |
| `LOG_LEVEL` | `info` | Nível do log JSON (pino), com `correlation_id`. |

`GET /healthz` (processo), `GET /readyz` (as duas conexões com o banco) e `GET /metrics` (Prometheus, incluindo
`gateway_tool_calls_total{server,outcome}`).

## Proxy de modelos

`POST /v1/messages` recebe a chamada do Claude Code (`ANTHROPIC_BASE_URL` = gateway, `ANTHROPIC_AUTH_TOKEN` = token
`shg_...`, `ANTHROPIC_API_KEY` vazia), troca o token do dev por `Authorization: Bearer <MODEL_UPSTREAM_KEY>` e repassa
a requisição a `MODEL_UPSTREAM_URL`. O corpo da resposta, inclusive o stream SSE, volta byte a byte; uma cópia de cada
chunk alimenta o contador de uso (`src/model-proxy/usage-tracker.ts`).

- Só `content-type`, `accept`, `anthropic-version`, `anthropic-beta` e `user-agent` seguem ao provedor. `x-api-key`, cookies e o token do dev ficam no gateway.
- Token inválido, revogado ou ausente: 401 antes de ler o corpo. Nada é gravado (não há usuário a atribuir).
- O provedor responde 401, 403 ou redireciona (a chave do gateway foi recusada): o dev recebe 502, para não confundir com token de dev inválido.
- Provedor inalcançável: 502 e registro `unreachable`. Sem retry nem fallback.
- Prioridade do provedor Anthropic é configuração da conta/preset no OpenRouter; o gateway não altera o corpo da requisição.

Cada requisição encaminhada grava uma linha em `model_usage` (migration `0005_model_usage.sql`): usuário, tenant e projeto
(se o header `x-smart-harness-project` nomear um projeto do squad do dev), harness (do `user-agent`; `claude-cli` vira
`claude-code`), modelo, tokens de entrada, saída e cache, status HTTP, resultado e duração. O texto do prompt nunca é
gravado nem logado: do corpo da requisição só se lê o campo `model`.

Os tokens do stream são cumulativos: cada campo presente em `message_start` ou `message_delta` substitui o anterior e o campo
ausente preserva o valor (nada é somado). Resultado (`outcome`):

| Resultado | Quando |
| --- | --- |
| `ok` | Stream com `message_stop`, ou resposta JSON completa. |
| `stream_error` | Evento SSE `error`, mesmo após HTTP 200. |
| `incomplete` | Stream terminou sem `message_stop`, a conexão caiu ou o cliente saiu antes do fim. |
| `upstream_error` | O provedor respondeu status diferente de 2xx. O status e o corpo seguem ao dev (exceto 401/403/3xx, ver acima). |
| `unreachable` | Sem resposta do provedor. |

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:8081 ANTHROPIC_AUTH_TOKEN=$SHG ANTHROPIC_API_KEY= claude -p "responda só OK"
sqlite3 data/smart-harness.db "select harness, model, input_tokens, output_tokens, outcome from model_usage order by id desc limit 1"
```

## Chamada manual

```bash
curl -sS -X POST 127.0.0.1:8081/mcp/projects/investimentos-api/echo \
  -H "Authorization: Bearer $GATEWAY_TOKEN" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Dependências

- `fastify`: servidor HTTP consolidado, com logs JSON (pino) e `inject()` para testar rotas sem abrir porta.
- `@modelcontextprotocol/sdk`: SDK oficial do MCP. Implementa o transporte Streamable HTTP e o protocolo; o cliente do SDK também é usado nos testes.
- `better-sqlite3`: acesso síncrono ao SQLite, o mesmo driver da API (binário pré-compilado, sem compilador na imagem).
- `@prometheus-io/client`: métricas no formato Prometheus, o mesmo da API.
- `typescript` e `@types/node`, `@types/better-sqlite3`: checagem de tipos (`tsc`, sem emitir arquivos).
- `eslint`, `@eslint/js` e `typescript-eslint`: lint com as regras recomendadas para TypeScript.
- `vitest`: runner de testes com suporte nativo a TypeScript.

## Fora do escopo desta etapa

Backends reais (#14), sessões MCP, roteamento entre provedores, cache, limite de uso, rate limit, retry, `count_tokens`, métricas Prometheus do proxy.
