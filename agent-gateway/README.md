# agent-gateway

Porta única do coding agent para MCPs e modelos, em Node/TypeScript. Hoje atende MCP em
`POST /mcp/projects/{project}/{server}`, com os backends `project`, `github`, `trello` e `notion`.
O proxy de modelos fica na #15.

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
| `LOG_LEVEL` | `info` | Nível do log JSON (pino), com `correlation_id`. |
| `PROJECT_CONTEXT_ROOT` | `examples/` do repositório | Raiz dos projetos de referência. No container: `/app/examples`. |
| `GITHUB_TOKEN` | vazio | PAT de serviço para o MCP remoto oficial readonly do GitHub. |
| `TRELLO_API_KEY`, `TRELLO_TOKEN` | vazios | Credenciais de serviço da API Trello. Devem ser configuradas juntas. |
| `NOTION_TOKEN` | vazio | Token da integração interna do Notion, com acesso somente às páginas necessárias. |

`GET /healthz` (processo), `GET /readyz` (as duas conexões com o banco) e `GET /metrics` (Prometheus, incluindo
`gateway_tool_calls_total{server,outcome}`).

## Chamada manual

`project` está sempre registrado; os serviços externos só são registrados quando suas credenciais existem.
O mapping explícito `investimentos-api → investimentos-api/` liga o slug da API ao diretório em
`PROJECT_CONTEXT_ROOT`, sem inferir o caminho a partir de argumentos do usuário.

O seed local concede acesso ao contexto somente para `investimentos-api`. No compose, configure
`GITHUB_PROJECT_REPO`, `TRELLO_PROJECT_BOARD` e `NOTION_PROJECT_PAGE` com os recursos reais, além das credenciais
do gateway. `docker compose exec -T api npm run seed` aplica esses identificadores. O seed é dono das
permissões do projeto de exemplo nesses servidores: executá-lo novamente substitui os grants anteriores
pelos configurados. Não é uma interface de administração para outros projetos.

### Tools e limites

| Servidor | Tools | Restrição |
| --- | --- | --- |
| `project` | `project_overview`, `decisions_search`, `backlog_list`, `backlog_get`, `delivered_list` | Lê `project.yaml`, README e documentos Markdown com frontmatter; informa a fonte relativa ao repositório. |
| `github` | `get_file_contents`, `issue_read`, `pull_request_read` e quatro buscas | Somente leitura; `owner/repo` precisa estar autorizado. |
| `trello` | `list_cards`, `get_card` | Exigem `board`; o card consultado precisa pertencer ao board permitido. |
| `notion` | `read_page`, `search_pages` | Pesquisa títulos somente das páginas permitidas; leitura de blocos textuais diretos, sem expandir páginas filhas, mentions ou synced blocks. |

GitHub usa o MCP oficial em `https://api.githubcopilot.com/mcp/readonly`. `search_code`, `search_commits`,
`search_issues` e `search_pull_requests` exigem qualificadores positivos `repo:owner/repo`, todos permitidos.
Buscas com `OR`, negação, aspas, regex ou escopos `org:`/`user:` são recusadas; `search_repositories` não é
exposta. Essa sintaxe restrita evita ampliar uma busca para fora dos repositórios autorizados.

O MCP oficial do Trello exige autenticação interativa por OAuth/browser. O hosted MCP do Notion também
usa OAuth; a alternativa oficial self-hosted com bearer não recebe manutenção ativa. Para as credenciais
de serviço desta fase, os dois adapters usam REST, com autenticação em headers e redirects desativados.
Não foi realizada uma tentativa autenticada de OAuth: a escolha se apoia no contrato oficial documentado.

As respostas são reduzidas com JSON válido e sinalização de truncamento. Identidade e fonte são
preservadas; conteúdos e metadados extensos podem ser resumidos. `project` devolve `next_cursor`, vinculado
ao snapshot e aos filtros. Trello usa `limit`, `sort=-id` e `before` na API: `next_cursor` aponta para o
último card devolvido, inclusive quando o limite da resposta reduz a página. Notion mantém o cursor de
blocos do provedor; sua busca percorre apenas os IDs permitidos. Não há promessa de snapshot estável
quando o conteúdo dos serviços muda entre chamadas.

GitHub conserva respostas pequenas do MCP remoto. Arrays grandes ou objetos com `items` recebem
`nextCursor`: repita os argumentos, acrescentando `harnessCursor`, até `upstreamPageComplete: true`.
Só então avance `page` na API remota. Se a página remota mudar, a continuação retorna
`upstream_page_changed` e pede reinício dessa página. Outros objetos grandes recebem preview explícito,
sem cortar um JSON serializado ao meio. Cada operação abre e fecha seu próprio cliente remoto, com
timeout e sem retry. O limite é 8.000 caracteres de JSON para contexto/GitHub e 8.000 bytes para Trello/Notion.

### Exemplo com contexto real

Depois do seed, use o token do gateway criado pela API; não coloque credenciais de serviço no cliente:

```bash
curl -sS http://127.0.0.1:8081/mcp/projects/investimentos-api/project \
  -H "Authorization: Bearer $GATEWAY_TOKEN" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"decisions_search","arguments":{"query":"DynamoDB"}}}'
```

O retorno inclui os ADRs encontrados e caminhos como `examples/investimentos-api/docs/adr/ADR-0001-single-table-sem-scan.md`.

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
- `js-yaml`: leitura do YAML de `project.yaml` e dos frontmatters, com `JSON_SCHEMA` e validação de tipos.
- `@prometheus-io/client`: métricas no formato Prometheus, o mesmo da API.
- `typescript` e `@types/node`, `@types/better-sqlite3`: checagem de tipos (`tsc`, sem emitir arquivos).
- `eslint`, `@eslint/js` e `typescript-eslint`: lint com as regras recomendadas para TypeScript.
- `vitest`: runner de testes com suporte nativo a TypeScript.

## Fora do escopo desta etapa

Proxy de modelos (#15), sessões e SSE, rate limit, retry, escrita nos serviços externos e OAuth delegado.

### Referências

- [GitHub MCP remoto](https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md)
- [Trello MCP oficial](https://github.com/atlassian/trello-mcp-server)
- [Trello REST — autorização](https://developer.atlassian.com/cloud/trello/guides/rest-api/authorization/)
- [Trello — paginação de cards](https://developer.atlassian.com/cloud/trello/guides/rest-api/nested-resources/#nested-cards-as-url-params)
- [Notion MCP](https://developers.notion.com/guides/mcp/overview)
- [Notion MCP self-hosted](https://developers.notion.com/guides/mcp/hosting-open-source-mcp)
- [Notion — versão da API](https://developers.notion.com/reference/versioning)
