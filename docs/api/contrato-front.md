# Contrato da API para o front (sh-saas)

Lista do que o front consome do sh-control-plane na Fase 1. A fonte da verdade é `control-plane/openapi.json`; os tipos TypeScript saem de `npm --prefix control-plane run contract:types` para `front/src/api/schema.d.ts` (#7). Esta página é o índice; se divergir do OpenAPI, vale o OpenAPI.

## Convenções
- Base: `VITE_API_BASE_URL` (local: `http://127.0.0.1:8080`). CORS liberado só para a origem do front.
- Autenticação: `Authorization: Bearer <JWT>` obtido em `POST /v1/auth/dev-login` (só em ambiente local). Guardar em memória/`sessionStorage`. `401` → voltar ao login.
- Papéis vêm de `GET /v1/me` (`memberships[].role`). Mostrar visão ADMIN só se houver papel `ADMIN` em algum tenant. A API recusa de qualquer forma (403/404).
- Erro: `application/problem+json` `{type, title, status, code, detail?, correlation_id, errors?[{path,message}]}`. Mostrar `detail` e `correlation_id`.
- Lista: `?limit=` (1–100) e `?cursor=`; resposta `{items, next_cursor}`; "carregar mais" usa `next_cursor` até `null`.
- Recurso de outra squad responde 404, igual a inexistente.

## Endpoints por tela
| Tela | Método e caminho | Tipo de resposta | Issue |
|---|---|---|---|
| Login | `POST /v1/auth/dev-login` `{email}` | `{access_token, token_type, expires_in}` | #6 |
| Shell | `GET /v1/me` | `{user, memberships[{tenant, role}]}` | #6 |
| Workspace | `GET /v1/workspace` | `{user, projects[{slug,name,description,tenant,counts,baseline}]}` | #7 |
| Marketplace | `GET /v1/marketplace?kind=&project=&q=&cursor=&limit=` (`project`: opcionais do projeto) | `Page<PluginItem>` | #7 |
| Detalhe | `GET /v1/plugins/{name}` | `PluginItem` | #7 |
| Detalhe (versões) | `GET /v1/plugins/{name}/versions` | `Page<PluginVersion>` | #7 |
| Prepare seu ambiente | `GET /v1/projects/{slug}/setup-plan` | `SetupPlan` (mostrar `harness setup <slug>` e `harness doctor`) | #7 |
| Pessoas e acesso | `GET /v1/tenants/{slug}/members` | `Page<Member>` (ADMIN) | #7 |
| Perfil: tokens | `POST/GET /v1/me/gateway-tokens`, `DELETE /v1/me/gateway-tokens/{id}` | `GatewayTokenCreated` (valor aparece uma vez) / `{items}` | #8 |
| Minhas criações | `POST/GET /v1/drafts`, `GET/PATCH/DELETE /v1/drafts/{id}` (`PATCH` exige `If-Match: "<revision>"`; 412 = recarregar) | `Draft`, `Page<DraftSummary>` | #16 |
| Validar | `POST /v1/drafts/{id}:validate` | `ValidationResult {valid, digest, findings[{code,severity,message,hint,path,line}]}` | #16 |
| Testar localmente | (texto) `harness draft pull <id>` e `claude --plugin-dir <dir>` | — | #10, #16 |
| Enviar | `POST /v1/drafts/{id}:submit`; `POST /v1/contributions/{id}:withdraw` | `Contribution` | #16 |
| Contribuições | `GET /v1/contributions?view=mine\|review&state=&cursor=&limit=`, `GET /v1/contributions/{id}` | `Page<Contribution>`, `ContributionDetail` | #16 |
| Aprovações (ADMIN) | `POST /v1/contributions/{id}:approve` `{digest, comment?}`; `:request-changes` `{digest, comment}` | `Contribution` | #16 |
| Pacote base (ADMIN) | `GET /v1/projects/{slug}/baseline`; `PUT /v1/projects/{slug}/baseline/{plugin}` `{version}`; `POST .../{plugin}:rollback`; `DELETE .../{plugin}` | `Baseline` | #16 |

## Mapeamento de estados para o pipeline da tela
| API | Tela |
|---|---|
| rascunho sem validação válida da revisão atual | Rascunho |
| validação válida da revisão atual, sem envio | Em teste |
| `submitted` | Em revisão |
| `changes_requested`, `invalidated` | Ajustes solicitados |
| `published` | Publicado |
| `withdrawn` | Retirado |

## Regras que a tela deve refletir
- O ADMIN não vê "Aprovar" nas próprias contribuições; a API responde 403 se forçado.
- "Aprovar" envia o `digest` exibido; se o rascunho mudou, a API responde 409 e a contribuição vira `invalidated`.
- Visibilidade do rascunho: `squad` (padrão) ou `organization`, editável até o envio.
- Nenhum estado de contribuição fica no navegador; `front/src/data/demo.ts` e `useWorkspaceState.ts` deixam de ser fonte de dados.
