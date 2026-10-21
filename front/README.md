# Smart Harness — frontend

Workspace React + TypeScript + Vite integrado à API. Login local, identidade e
papéis por squad, projetos autorizados e composição do pacote base nas versões
fixadas pelo backend. Interface em pt-BR; tipos HTTP gerados do OpenAPI.

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

## Demonstrar a entrega

1. Entre como `dev@smart-harness.local`: Conta e Investimentos aparecem, com
   counts de agentes/skills/MCPs vindos do baseline de cada projeto.
2. Abra Investimentos. Confira `investimentos-base` versão `1.1.0`, seu agente,
   skills e MCP. Recarregue `/workspace/projects/investimentos-api`.
3. Troque para Conta pelo seletor e teste voltar/avançar no navegador.
4. Saia e entre como `dev.cartoes@smart-harness.local`: somente Cartões aparece.
   Abra `/workspace/projects/investimentos-api`: o resultado é indisponível,
   igual a um slug inexistente. `admin@smart-harness.local` vê os três projetos
   e seus papéis reais; não há alternância simulada de autorização.
5. Para testar falha sem parar serviços compartilhados, use **Network → Offline**
   no DevTools, abra um projeto e observe o erro; volte para **Online** e use
   **Tentar novamente**. Usuário desconhecido mantém o formulário com erro útil.
6. Teste Tab/Shift+Tab, Enter e Escape na navegação mobile e larguras de 390,
   768 e 1440 pixels. O seletor de projeto permanece disponível em telas estreitas.

O estado sem memberships é coberto por teste automatizado, pois o seed padrão
não inclui esse usuário. Não altere o seed apenas para demonstrar essa tela.
O Marketplace completo, download, tokens e setup fazem parte das próximas issues.

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

As quatro operações HTTP têm timeout de 10 segundos e cancelamento. Seguindo a
convenção da Fase 1 em `CLAUDE.md`, não há retry automático, backoff nem circuit
breaker: uma falha termina em erro recuperável, com retry explícito do usuário.
A tela troca para loading e desabilita envio repetido; não existe polling.
`correlation_id` de Problem JSON fica acessível em “Informações para suporte”.
A lista de projetos respeita o limite de até 100 da API, que não tem cursor.
O plano retorna opcionais, mas esta entrega renderiza somente o baseline fixado.

## Organização e identidade visual

- `src/api`: client HTTP compartilhado e tipos gerados.
- `src/app`: sessão, navegação pelo History API e ciclo de requests.
- `src/pages`: login, workspace e composição do projeto.
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
