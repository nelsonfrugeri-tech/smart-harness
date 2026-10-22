# Onboarding da demo TOTVS

Roteiro principal: login → token pessoal → CLI → checkout do fork → Conectores e
Skills → desenvolvimento → review independente → merge no fork. O exemplo
Investimentos continua disponível ao final deste documento.

## Preparação do mantenedor

Siga [a preparação md2poui](../examples/md2poui/README.md): publique a história no
Trello e a ADR no Notion, autorize esses recursos no gateway e execute o seed.
As credenciais ficam no servidor. A existência do projeto ou de um pacote não
comprova conexão: valide a leitura real do card, ADR e fork antes da apresentação.
O baseline esperado é `md2poui-base`, com agentes `developer` e `reviewer`;
Graphify e deja-vu usam ferramentas locais e suas skills do catálogo.

## Jornada do desenvolvedor

1. Entre como `dev@smart-harness.local` na instância local e abra **Preparar demo
   TOTVS** no workspace ou em **Conectores e Skills**. O atalho aparece somente
   quando a API retorna o projeto `md2poui` para sua conta.
2. Em **Meus tokens**, crie o token pessoal. Guarde o segredo para o prompt sem
   eco do setup; não coloque o token no comando.
3. Baixe o binário adequado em [releases da CLI](https://github.com/nelsonfrugeri-tech/smart-harness/releases/latest),
   confira `SHA256SUMS`, coloque `harness` no PATH e execute `harness version` e
   `harness tools check`. A release precisa incluir o comando `tools`; a antiga
   v0.1.0 não comprova suporte a esta jornada. Se a release ainda não incluir o
   comando, use o binário compilado da revisão validada pelo mantenedor. Antes de
   instalar as ferramentas, `tools check` pode informar que elas estão ausentes;
   depois da instalação, precisa retornar sucesso.
4. Tenha Claude Code ≥ 2.1.305, Node.js 24, Git, uv/Python ≥ 3.10 e Go ≥ 1.25.
   Em uma pasta nova:

```sh
git clone --branch demo-start https://github.com/nelsonfrugeri-tech/md2poui.git
cd md2poui
npm ci --ignore-scripts
npm test
```

5. Continue nesse checkout. Instale e confira as ferramentas locais antes do
   setup. Copie da plataforma o comando de setup e confirme
   a URL pública da API. A página acrescenta os complementos Graphify/deja-vu
   quando eles aparecem nos opcionais do plano retornado. Exemplo:

```sh
harness tools install graphify
harness tools install deja-vu
harness tools check
harness setup 'md2poui' --api-url 'http://127.0.0.1:8080' --include-optional graphify,deja-vu
harness doctor
```

6. Abra desenvolvimento e peça a leitura da história Trello e da ADR vinculada
   antes da implementação. Graphify deve navegar o código; deja-vu deve recuperar
   histórico real da preparação. Não trate ausência de histórico como resultado.

```sh
claude --agent 'md2poui-base:developer'
```

7. Depois do PR, abra outra sessão no checkout para review independente:

```sh
claude --agent 'md2poui-base:reviewer'
```

Corrija BLOCKER/MAJOR, verifique novamente e faça merge apenas no fork. Preserve
`demo-start` para outro ensaio. Comandos de agentes só aparecem no frontend se
os respectivos componentes constarem no baseline retornado pela API.

## Aceite da jornada

Recarregue `/workspace/projects/md2poui#setup`. Confira composição e tags reais,
use Tab/Enter para abrir o setup e copiar comandos. A mensagem de cópia confirma
somente o clipboard, sem anunciar instalado/conectado. Valide 390, 768 e 1440 px.
Para testar erro, use Network → Offline, navegue para o projeto e confira que
nenhum comando antigo permanece; volte online e tente novamente. Teste também
uma conta sem acesso: não deve aparecer o atalho da demo.

A verificação do terminal e as leituras reais dos conectores fazem parte do QA;
o frontend não recebe esses resultados. Não declare a demo pronta apenas pelo
build ou pelos testes DOM.

---

# Onboarding de um dev de Investimentos

Roteiro único, do login ao Claude Code respondendo sobre o `investimentos-api` com as fontes
citadas. O dev configura só o token pessoal. As credenciais de GitHub, Trello, Notion e do
modelo ficam no gateway.

Os comandos estão na ordem de uso. Rode cada bloco num terminal zsh, na raiz do repositório,
salvo quando o texto indicar outra pasta.

## 1. Pré-requisitos

- Docker com Compose.
- Node 24, para o front.
- `gh` autenticado numa conta com acesso ao repositório, para baixar a release da CLI.
- Claude Code 2.1.305 ou mais novo. É a versão mínima exercitada pelo projeto.

## 2. Configurar o `.env` (mantenedor)

Esta etapa é do mantenedor da stack, não do dev. O `.env` está no `.gitignore` e nunca vai
para o git.

```bash
cp .env.example .env
```

Preencha no `.env`:

| Variável | Valor |
| --- | --- |
| `GITHUB_REPOS` | Repositórios permitidos, `owner/repo` separados por vírgula |
| `TRELLO_BOARD_ID` | Short id do board permitido, o trecho depois de `/b/` na URL do board |
| `NOTION_PAGE_IDS` | IDs das páginas permitidas, 32 caracteres hex, separados por vírgula |
| `GITHUB_TOKEN` | Token fine-grained, somente leitura, só nos repositórios acima |
| `TRELLO_API_KEY`, `TRELLO_TOKEN` | Chave e token de <https://trello.com/power-ups/admin> |
| `NOTION_TOKEN` | Token da integração interna, compartilhada com as páginas acima |
| `MODEL_UPSTREAM_KEY` | Chave OpenRouter da organização |

O `compose.yaml` entrega os três primeiros à API, e o `make seed` os grava em
`gateway_permissions` para o projeto `investimentos-api`. As credenciais vão só para o
container do gateway. Uma credencial vazia desliga o servidor MCP correspondente.

Para achar o short id do board pela API do Trello, carregue o `.env` em um subshell e liste os
boards da conta. Na saída, procure o `name` do board e copie o `shortLink`:

```bash
(
set -a
source .env
set +a
curl -s -H "Authorization: OAuth oauth_consumer_key=\"$TRELLO_API_KEY\", oauth_token=\"$TRELLO_TOKEN\"" "https://api.trello.com/1/members/me/boards?fields=name,shortLink"
)
```

## 3. Subir a stack e o seed

```bash
make up
make seed
```

O `make up` termina quando `api`, `gateway` e `minio` estão `Healthy`. O primeiro comando do
seed imprime `seed applied` com `gatewayPermissions` maior que zero. O segundo imprime
`marketplace seed applied` com `baseline` preenchido.

Depois de mudar `GITHUB_REPOS`, `TRELLO_BOARD_ID` ou `NOTION_PAGE_IDS`, rode `make up` e
`make seed` de novo. O seed substitui as permissões do servidor pelo que está no `.env`.

## 4. Subir o front

Em outro terminal:

```bash
cd front
npm ci --no-audit --no-fund
npm run dev -- --port 5173
```

O Vite imprime `Local: http://127.0.0.1:5173/`. Ele encaminha `/v1` para a API em
`http://127.0.0.1:8080`.

## 5. Login e projetos

Abra <http://127.0.0.1:5173> e entre como `dev@smart-harness.local`. A barra lateral mostra
Investimentos e Conta. Cartões não aparece, porque o dev não é membro dessa squad.

## 6. Criar o token pessoal

Clique em **Meus tokens**, dê um nome ao token e clique em **Criar token**. O segredo
`shg_...` aparece uma única vez. Copie-o e guarde-o até o passo 8. Nunca cole o token dentro
de um comando.

## 7. Instalar a CLI da release

O exemplo usa macOS em Apple Silicon. Para outra plataforma, troque o padrão por
`harness-v0.1.0-darwin-amd64`, `harness-v0.1.0-linux-amd64` ou `harness-v0.1.0-linux-arm64`,
no download e nos dois comandos seguintes.

```bash
mkdir -p ~/.local/bin
cd "$(mktemp -d)"
gh release download v0.1.0 --repo nelsonfrugeri-tech/smart-harness --pattern 'harness-v0.1.0-darwin-arm64' --pattern SHA256SUMS
shasum -a 256 -c --ignore-missing SHA256SUMS
chmod +x harness-v0.1.0-darwin-arm64
mv harness-v0.1.0-darwin-arm64 ~/.local/bin/harness
harness version
```

O `shasum` imprime `harness-v0.1.0-darwin-arm64: OK`. O último comando imprime
`harness v0.1.0 (commit ...)`. Se o shell não achar `harness`, inclua `~/.local/bin` no
`PATH`.

Sem acesso à release, compile a partir do repositório:

```bash
go -C cli build -o bin/harness ./cmd/harness
```

## 8. Setup do projeto

No front, abra o projeto **Investimentos API**. Na seção **Preparar no terminal**, confira a
URL da API e clique em **Copiar comando de setup**. O comando copiado tem esta forma:

```bash
harness setup 'investimentos-api' --api-url 'http://127.0.0.1:8080'
```

No primeiro uso, o `harness` pede o token sem eco no terminal. Cole o token do passo 6. A
saída lista `gateway http://127.0.0.1:8081`, `installed investimentos-base 1.2.1 (sha256:...)`
e o comando para abrir o agente.

O setup grava no `~/.claude/settings.json` só as cinco chaves do `env` que apontam o Claude
Code para o gateway. O resto do arquivo é preservado.

## 9. Diagnóstico

```bash
harness doctor
```

Todas as linhas começam com `ok`: `claude-code`, `config`, `api`, `token`, `gateway`,
`settings`, `plugin investimentos-base` e `plan`. Uma linha `FAIL` vem com um `fix:` que diz
o que fazer.

## 10. Perguntas no Claude Code

```bash
cd examples/investimentos-api
claude --agent investimentos-base:investimentos-guide
```

Na primeira chamada de cada MCP, o Claude Code pede permissão. Aprove as tools de `project`,
`github`, `trello` e `notion` do plugin `investimentos-base`.

Faça as duas perguntas:

1. `como este projeto está organizado?` O agente consulta `project_overview` e
   `decisions_search`, lê o ADR-0001 pelo GitHub e explica módulos e modelo de dados. Cada
   afirmação cita o ADR (por exemplo,
   `investimentos-api/docs/adr/ADR-0001-single-table-sem-scan.md`) ou o caminho no repositório.
2. `o que tem no backlog? inclua os cards do board do Trello do projeto` O agente lista os
   itens de `docs/backlog/` (BL-001 a BL-103) e os cards abertos do board permitido, com a URL
   de cada card. Só `o que tem no backlog?`, sem citar o Trello, costuma trazer apenas o
   backlog do repositório.

Para rodar sem interação, por exemplo num teste, libere as tools na linha de comando:

```bash
claude --agent investimentos-base:investimentos-guide --allowedTools mcp__plugin_investimentos-base_project mcp__plugin_investimentos-base_github mcp__plugin_investimentos-base_trello mcp__plugin_investimentos-base_notion -p "como este projeto está organizado?"
```

## 11. Recurso negado, auditoria e uso do modelo

Leia o token sem eco e peça os cards de um board que não está em `gateway_permissions`. Troque
`OUTRO_BOARD` pelo short id de qualquer outro board.

```bash
read -rs "SMART_HARNESS_TOKEN?token: "
curl -s http://127.0.0.1:8081/mcp/projects/investimentos-api/trello -H "Authorization: Bearer $SMART_HARNESS_TOKEN" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"trello_list_cards","arguments":{"board_id":"OUTRO_BOARD"}}}'
unset SMART_HARNESS_TOKEN
```

A resposta tem `isError: true` e o texto
`Access denied: the tool or resource is not allowed for this project.`

Na raiz do repositório, veja as chamadas de tools auditadas, agrupadas por servidor e
resultado. A chamada acima aparece como `trello`, `denied`, `resource_not_allowed`.

```bash
docker compose exec -T api node -e 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync("/data/control-plane.sqlite",{readOnly:true});console.table(db.prepare("select json_extract(details,\x27$.server\x27) server, json_extract(details,\x27$.outcome\x27) outcome, json_extract(details,\x27$.reason\x27) reason, count(*) n from audit_events where action=\x27gateway.tool_call\x27 group by 1,2,3").all())'
```

Veja o uso do modelo registrado pelo gateway, por modelo e resultado. Cada chamada do Claude
Code gera uma linha com tokens de entrada e saída, status HTTP e duração.

```bash
docker compose exec -T api node -e 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync("/data/control-plane.sqlite",{readOnly:true});console.table(db.prepare("select model, outcome, http_status, count(*) n, sum(output_tokens) output_tokens from model_usage group by 1,2,3").all())'
```

## Instância isolada

Para rodar ao lado de outra stack, use outro nome de projeto Compose e outras portas num env
file próprio, com `API_PORT`, `GATEWAY_PORT` e `MINIO_PORT` livres. Nos passos acima, troque
`8080` e `8081` pelas portas escolhidas e use `-p <nome> --env-file <arquivo>` em cada
`docker compose`.

```bash
docker compose -p sh-demo --env-file ../sh-demo.env up --build --detach --wait
docker compose -p sh-demo --env-file ../sh-demo.env exec -T api npm run --silent seed
docker compose -p sh-demo --env-file ../sh-demo.env exec -T api npm run --silent seed:marketplace
```

No front, aponte o proxy para a API dessa instância:

```bash
cd front
HARNESS_API_TARGET=http://127.0.0.1:18180 npm run dev -- --port 15180 --strictPort
```

## Problemas comuns

| Sintoma | Causa e ação |
| --- | --- |
| `API Error: 402 ... exceed your available credits` | O OpenRouter reserva crédito para o `max_tokens` do pedido. Com pouco saldo, até um pedido pequeno é recusado. Adicione crédito à chave da organização. |
| O agente diz que as tools do projeto estão bloqueadas | No modo interativo, aprove as tools quando o Claude Code pedir. Com `-p`, use `--allowedTools`. |
| `doctor` com `FAIL` em `token` | Token revogado ou expirado. Crie outro em **Meus tokens** e rode o setup de novo. |
| O agente não acha board, repositório ou página | `GITHUB_REPOS`, `TRELLO_BOARD_ID` ou `NOTION_PAGE_IDS` vazio no `.env`. Preencha e rode `make up` e `make seed`. |
