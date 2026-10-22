# cli

CLI `harness` em Go, com o engine de pacotes: valida o pacote, gera a camada de cada coding agent, calcula o digest e empacota.

O único `go.mod` do repositório fica aqui, então os comandos Go rodam com `go -C cli`.

```bash
go -C cli test ./...
go -C cli build -ldflags "-X main.version=0.2.1 -X main.commit=$(git rev-parse --short HEAD)" -o bin/harness ./cmd/harness
```

A imagem da API (`control-plane/Dockerfile`) compila este binário e o instala em `/usr/local/bin/harness`.

## Comandos

| Comando | Faz | Saída |
|---|---|---|
| `harness vendor=claude [argumentos do Claude Code...]` | Abre uma sessão Claude via OpenRouter pelo gateway; padrão `openrouter/free` | Terminal interativo e exit code do Claude |
| `harness version` | Versão e commit | `harness 0.2.1 (commit abc1234)` |
| `harness validate <dir> [--json] [--gateway-origin <url>]` | Aplica as regras abaixo | Relatório JSON ou uma linha por achado |
| `harness generate <dir> --target <nome> [--gateway-origin <url>]` | Valida e grava a camada do target no próprio diretório | Um caminho por arquivo gerado |
| `harness digest <dir>` | Digest do tar.gz que o `pack` gravaria | `sha256:<hex>` |
| `harness pack <dir> -o <arquivo.tar.gz>` | tar.gz reproduzível | O digest |
| `harness unpack <arquivo> <destino> [--expect-digest sha256:<hex>]` | Confere o digest do arquivo e extrai com checagens | O digest |
| `harness login --api-url <url>` | Autentica o token digitado sem eco e configura gateway e catálogo pessoal | Tools/Skills instalados ou pendências explícitas |
| `harness install <nome> [nome...]` | Alias legado de instalação pessoal, sem filtro de categoria | Instalações/atualizações e erros acionáveis |
| `harness setup <projeto> [--api-url <url>] [--include-optional <a>,<b>]` | Instala o pacote base (e opcionais) no Claude Code e configura os MCPs do gateway | Uma linha por plugin e o comando para abrir o agente |
| `harness sync` | Aplica o setup-plan atual de todos os projetos configurados | Uma linha por plugin |
| `harness tools install <nome> [nome...]` | Instala pacotes MCP e os runtimes fixados de Graphify/deja-vu, quando selecionados | Versão verificada ou erro acionável |
| `harness tools check [nome]` | Verifica pacotes Tools instalados e seus runtimes locais | Versão, estado vazio ou instrução de reparo |
| `harness skills install <nome> [nome...]` | Instala pacotes da categoria Skills | Instalações/atualizações e erros acionáveis |
| `harness skills check [nome]` | Verifica pacotes Skills instalados | Versão, estado vazio ou instrução de reparo |
| `harness tools serve <graphify\|deja-vu>` | Executa MCP stdio curado enquanto a sessão existir | Apenas protocolo MCP no stdout |
| `harness tools run <graphify\|deja-vu> <args...>` | Executa ferramenta gerenciada com argumentos literais | Saída upstream |
| `harness doctor` | Checa Claude Code, API, token, gateway, `settings.json`, plugins e plano | `ok` ou `FAIL` com `fix:` por checagem |
| `harness draft pull <id> [--dir <dir>]` | Baixa o rascunho para teste local | O diretório e o comando `claude --plugin-dir` |

Exit codes: `0` sucesso; `1` pacote inválido ou operação recusada; `2` uso incorreto ou erro de I/O.

`--gateway-origin` define a única origem aceita para MCPs. O padrão é `http://127.0.0.1:8081`, o gateway do `compose.yaml`. O pacote grava essa origem canônica; na máquina do dev, `SMART_HARNESS_GATEWAY_URL` a substitui.

## Instalação na máquina do dev

Com Claude Code disponível no PATH, execute o comando fornecido pela plataforma:

```sh
curl -fsSL http://127.0.0.1:8080/install | sh
```

O endpoint publica `cli/install.sh` com origem e versão fixadas. O script detecta
macOS/Linux e arm64/amd64, baixa o binário e `SHA256SUMS`, verifica o checksum e só
então substitui o executável. Instala sem sudo em `HARNESS_INSTALL_DIR`, quando
definido, ou em um diretório gravável do usuário no PATH; o fallback é
`~/.local/bin`. Se necessário, adiciona uma única linha ao arquivo de inicialização
do shell (`.zshrc`, `.bashrc`, `.bash_profile` ou `.profile`), preservando seu conteúdo.
Abra outro terminal para carregar essa alteração de PATH.

O login roda pelo caminho final do binário e pede o token em `/dev/tty`, sem eco,
mesmo quando o script veio por pipe. Nenhum token vai em argumento ou variável de
ambiente do instalador. O script exige Claude Code; o login direto continua
funcionando antes de instalar Claude. Não há login adicional no navegador.

O fluxo legado por projeto continua disponível:

```bash
harness setup investimentos-api --api-url http://127.0.0.1:8080
harness doctor
harness sync
```

| Arquivo | Dono | Conteúdo |
|---|---|---|
| `~/.claude/skills/<plugin>/` | harness | Um diretório por plugin; o Claude Code carrega cada um em toda sessão (spike H1) |
| `~/.claude/smart-harness-staging/` | harness | Versões em troca; fica fora de `skills/` para o Claude Code nunca carregar uma cópia pela metade |
| `~/.claude/settings.json` | Claude Code | O `harness` grava só cinco chaves do `env` e preserva o resto |
| `~/.config/smart-harness/config.json` | harness | API, gateway, projetos, opcionais escolhidos, plugins instalados com digest, rascunhos baixados. Nunca guarda o token |
| `~/.config/smart-harness/harness.lock` | harness | Existe enquanto `setup`, `sync` ou `draft pull` roda |
| `~/.config/smart-harness/drafts/.staging/` | harness | Cópias de rascunho em troca, uma pasta por destino |

`HARNESS_CLAUDE_DIR` troca `~/.claude` (sem ela, vale `CLAUDE_CONFIG_DIR`, se existir) e `HARNESS_CONFIG_DIR` troca `~/.config/smart-harness`. Os testes usam as duas e nunca tocam o home real. `HARNESS_CLAUDE_BIN` troca o executável `claude` usado pelo `doctor`.

**Token.** Um segredo só: o token do gateway (`shg_` + 43 caracteres). Ordem de leitura: variável `SMART_HARNESS_TOKEN`; se ela não existir, `env.SMART_HARNESS_TOKEN` do `settings.json` gravado pelo setup. Assim, `sync`, `doctor` e `draft pull` funcionam num shell novo, sem exportar nada. No primeiro `setup`, sem variável nem `settings.json`, o CLI pede o token sem eco no terminal. Nenhum comando imprime o token: as mensagens nunca o incluem e, como última defesa, a saída troca o valor por `shg_***`. O cliente HTTP não segue redirect, e o `archive_url` do plano precisa começar com `/v1/`, então o token só vai para a origem da API configurada. A URL da API e a do gateway precisam ser `https`; `http` só vale em loopback (`localhost`, `127.0.0.1`, `::1`), como no `compose.yaml`. Quando o gateway do plano é novo ou muda, `setup` e `sync` imprimem `gateway <antiga> -> <nova>`, porque os prompts e o token vão para lá.

**`settings.json`.** Login, install, setup e sync gravam somente `SMART_HARNESS_TOKEN`,
`SMART_HARNESS_GATEWAY_URL` e os caminhos de runtime dos MCPs. Não alteram o login,
modelo ou provider do Claude. A migração remove `ANTHROPIC_BASE_URL`,
`ANTHROPIC_AUTH_TOKEN` e `ANTHROPIC_API_KEY` antigos somente quando o conjunto inteiro
corresponde exatamente ao gateway/token `SMART_HARNESS_*` já gravados e à API key
vazia. Configurações parciais ou de outros providers são preservadas. Outras chaves
mantêm o valor; quando há mudança, o arquivo anterior vai para
`settings.json.harness-backup-<UTC>`, com modo `0600`. A escrita é atômica, preserva
symlinks válidos e recusa JSON inválido antes de alterar plugins/config. Um sync
recria as variáveis MCP se o arquivo foi apagado.

**Reconciliação.** `setup` e `sync` leem o setup-plan de todos os projetos do config antes de mudar qualquer coisa. A instalação é global por nome, então o conjunto desejado é a união dos projetos:

- um plugin sai só quando nenhum projeto o usa;
- dois projetos com digests diferentes do mesmo plugin são erro, antes de qualquer alteração;
- dois projetos com gateways diferentes também;
- um diretório em `skills/` que o config não lista não é do harness: erro, sem tocar nele;
- plugin com o mesmo digest e o mesmo conteúdo não é baixado de novo. Um diretório alterado à mão é reinstalado.

**Troca segura.** Primeiro, todos os pacotes novos são baixados e extraídos em `smart-harness-staging/` (o `unpack` confere o digest do plano). Só depois começa a troca, plugin a plugin. `os.Rename` não substitui um diretório existente, então a troca é: mover a versão atual para `staging/<plugin>.previous`, mover a nova para `skills/<plugin>` e apagar a anterior. Se o segundo passo falhar, a anterior volta. Se o processo morrer entre os dois passos, o próximo comando devolve a anterior. O config é gravado depois de cada troca, então sempre descreve o disco.

**Um comando por vez.** `setup`, `sync` e `draft pull` criam `harness.lock` com `O_EXCL` antes de ler o config e o apagam no fim, também no Ctrl-C. Um segundo comando ao mesmo tempo para com `another harness command is running`. Se o processo morrer sem apagar o lock (`kill -9`), a mensagem diz qual arquivo remover. O `doctor` só lê e não usa o lock. No Ctrl-C durante o pedido do token, o eco do terminal volta antes de sair.

**Digests no config.** `digest` é o do arquivo baixado (o do plano). `content_digest` é o `harness digest` do diretório logo depois da instalação. O `doctor` recalcula o segundo, porque os pacotes do seed não foram empacotados pelo `harness pack` e o digest do arquivo não se reproduz a partir do diretório.

**`draft pull`.** Contrato: `GET /v1/drafts/{id}/archive` responde o tar.gz com o digest no header `x-package-digest` (o mesmo do download de versão). O destino padrão é `~/.config/smart-harness/drafts/<id>`. O comando pode ser repetido: o mesmo digest não muda nada; um digest novo troca a cópia com a mesma troca segura. A área de troca é `drafts/.staging/<hash do destino>`, do harness: nada ao lado do destino é criado ou apagado. Por isso o `--dir` precisa estar no mesmo file system do config (`os.Rename` não cruza file systems). `--dir` aceita um diretório ausente, vazio ou já usado por um pull do mesmo rascunho. A rota é da #16; hoje o comando é testado só contra uma API falsa.

**`doctor`.** Checa: Claude Code ≥ 2.1.305 (a versão do spike H1; anteriores não foram testadas), API (`/healthz`), token (`GET /v1/me`), gateway (`/healthz`), `env` do `settings.json`, conteúdo de cada plugin contra o `content_digest` e mudanças do plano ainda não aplicadas. Cada falha diz o que fazer. Exit `1` se alguma falhar.

Sem retry: cada chamada faz uma tentativa, com timeout de 15 s (JSON), 2 min (arquivo) e 5 s (`/healthz`).

## Release

Um tag `v*` roda `.github/workflows/release.yml`: `make check-go`, binários estáticos (`CGO_ENABLED=0`) para macOS (arm64, amd64) e Linux (amd64, arm64), `SHA256SUMS` e um GitHub Release com os arquivos.

## Pacote

```text
plugin.json                        # Agent Plugins 1.0.0
mcp.json                           # opcional, só servidores do gateway
README.md, LICENSE                 # opcionais
skills/<nome>/SKILL.md             # Agent Skills
skills/<nome>/{references,assets}/**
dev.smartharness/agents/<nome>.agent.md   # docs/contracts/agent.md
```

Depois de `generate --target claude-code`, o mesmo diretório ganha `.claude-plugin/plugin.json`, `.mcp.json` e `agents/<nome>.md` (decisão 2 da ADR-0001, spike H1). O `validate` aceita esses arquivos só se forem idênticos ao que o gerador produz. Assim, o mesmo validador serve para o pacote do autor e para o snapshot já gerado.

## Regras do `validate --json`

O relatório `report_version: "2"` inclui `description` (texto do manifesto, ou `""` quando ausente) e `keywords` (tags do manifesto, ou `[]` quando ausentes). Os valores são preservados sem normalização.

`digest` é o que `harness pack` imprimiria; `""` quando o `pack` recusaria o diretório. `components` lista só os componentes válidos (`agent`, `mcp`, `skill`), ordenados por tipo e nome. Todo achado tem `severity: "error"`. Os achados saem ordenados por `path`, `line` e `code`. `line` é 1-based; `0` quando o defeito não tem linha. `findings` é `[]` quando o pacote é válido. Nenhuma mensagem repete o texto que parece segredo.

```json
{"report_version": "2", "valid": false, "plugin": "example", "version": "1.0.0", "description": "Exemplo de pacote.", "keywords": ["review"], "digest": "sha256:…",
 "components": [{"kind": "agent", "name": "reviewer", "description": "…"}, {"kind": "mcp", "name": "docs", "description": ""}],
 "findings": [{"code": "SH-SEC-002", "severity": "error", "message": "…", "hint": "…", "path": "README.md", "line": 3}]}
```

| Código | Família | Regra |
|---|---|---|
| `AP-001` | Agent Plugins | `plugin.json` existe, é objeto JSON, tem `$schema` 1.0.0 e `name`, e só campos do schema |
| `AP-002` | Agent Plugins | `name` com 1–64 caracteres `a-z 0-9 . -`, alfanumérico nas pontas, sem `--` nem `..` |
| `AP-003` | Agent Plugins | `mcp.json` só com `$schema` 1.0.0 e `mcpServers`; servidor com `type` conhecido; URL absoluta, sem userinfo nem fragmento, HTTPS fora de loopback |
| `AS-001` | Agent Skills | Toda pasta de skill tem `SKILL.md` com frontmatter e `name` e `description` |
| `AS-002` | Agent Skills | `name` com 1–64 caracteres `a-z 0-9 -`, sem hífen nas pontas nem `--`, igual à pasta |
| `AS-003` | Agent Skills | `description` com 1–1024 caracteres; `compatibility` com 1–500 |
| `SH-AGT-001`…`005` | Contrato do agente | `docs/contracts/agent.md` |
| `SH-SEC-001` | Plataforma | Sem `headers` nem `env` em `mcp.json`: o núcleo não tem credencial nem referência a ela |
| `SH-SEC-002` | Plataforma | Nenhum arquivo com forma de credencial (GitHub, Anthropic, OpenAI, Slack, AWS, chave privada, JWT, `Bearer <20+>`) |
| `SH-MCP-001` | Plataforma | Servidor `streamable-http` com URL `<gateway-origin>/mcp/projects/<projeto>/<servidor>` |
| `SH-MCP-002` | Plataforma | `mcp.json` não aceita `stdio`, `command`, `args` nem `cwd`. A extensão curada descrita abaixo gera somente os dois comandos internos permitidos |
| `SH-EXE-001` | Plataforma | Sem hooks: pasta `hooks/`, arquivo `hooks.json` ou campo `hooks` no `plugin.json` ou no frontmatter do `SKILL.md`, escrito ou trazido por merge |
| `SH-EXE-002` | Plataforma | Sem executáveis: `bin/`, `skills/<n>/scripts/`, bit de execução, `#!` ou cabeçalho ELF, Mach-O, PE ou WebAssembly |
| `SH-STR-001` | Plataforma | Só os arquivos do layout acima; sem symlink, arquivo especial, `\` ou `:` no caminho |
| `SH-STR-002` | Plataforma | Arquivo gerado idêntico à saída do gerador |
| `SH-STR-003` | Plataforma | YAML simples no frontmatter de `SKILL.md` e de agente: sem anchor (`&`), alias (`*`), merge key (`<<`), tag explícita (`!!str`, `!x`), chave que não é string, chave repetida em qualquer nível ou segundo documento. JSON de `plugin.json` e `mcp.json` sem chave repetida em nenhum objeto |
| `SH-NAM-001` | Plataforma | Nome não reservado pelo Claude Code: sem `.`, sem prefixo `cc-plugin-` e sem as palavras `claude`, `anthropic` ou `anthropics` |
| `SH-MAN-001` | Plataforma | `description` presente e não vazia após remover espaços |
| `SH-VER-001` | Plataforma | `version` presente e em SemVer |
| `SH-LIM-001` | Plataforma | Até 2.000 arquivos, 5 MiB por arquivo e 50 MiB no total |

`SH-STR-003` existe porque o cliente resolve merge, alias e chave repetida (o último valor vence) antes de ler o arquivo. Uma regra que lesse só as chaves escritas veria outro conteúdo. Um `<<:` com `hooks:` no `SKILL.md`, por exemplo, registra um hook no Claude Code 2.1.305. Como defesa extra, os campos proibidos também são procurados no mapa já resolvido.

`SH-NAM-001` segue a checagem de nome do `claude plugin validate` ([plugins-reference](https://code.claude.com/docs/en/plugins-reference), consultada em 2026-10-21). Ela também rejeita os casos que o Claude Code só avisa, porque `--strict` transforma aviso em erro.

## Converter

```go
type Adapter interface {
	Name() string
	Convert(pkg.Package) ([]File, error)
}
```

- `pkg.Package` é o modelo canônico: manifest, agents, skills e MCPs, sem detalhe de harness. As tools são lógicas: `read`, `edit`, `shell`, `delegate`, `mcp:<servidor>` e `mcp:<servidor>/<tool>`.
- A conversão é pura: recebe o modelo e devolve arquivos ordenados, sem I/O. Quem grava é o `generate`.
- Capacidade que o harness não expressa vira `*converter.UnsupportedError`, nunca descarte silencioso.
- `converter/conformance_test.go` roda a mesma suíte em todo adapter: saída determinística, caminhos seguros e ordenados, nenhum segredo, todo componente convertido ou recusado com erro. Um adapter falso (`plain`), registrado só no teste, também passa. Adapters quebrados de propósito provam que a suíte falha.

Para adicionar um harness, crie `converter/<harness>/` com um `Adapter` e acrescente uma linha em `converter/targets/targets.go`. Pacote, API e gateway não mudam.

Fase 1: `claude-code` gera `.claude-plugin/plugin.json` (com `author`, exigido por `claude plugin validate --strict`; `Smart Harness` quando o núcleo não tem), `.mcp.json` com `${SMART_HARNESS_GATEWAY_URL:-<origem>}` e `Authorization: Bearer ${SMART_HARNESS_TOKEN}`, `agents/<nome>.md` pela regra do contrato, e as skills como estão.

## Digest e pacote

- **Digest:** `sha256:` + hex do sha256 dos bytes do tar.gz que o `pack` grava (contrato com a API, #7). `harness digest <dir>` e o `digest` do `validate` devolvem o mesmo valor que o `pack` imprimiria. Como o tar.gz é reproduzível, o mesmo conteúdo dá o mesmo digest; modo, datas, dono e pastas vazias não entram. `pack/pack_test.go` fixa o digest do pacote de exemplo, medido em macOS e Linux com Go 1.27.3; o CI roda em Linux. Uma versão do Go que mude a saída de `compress/flate` muda todos os digests: o teste fixado falha e avisa.
- **Pack:** tar.gz só com arquivos regulares, em ordem, modo `0644`, uid/gid `0`, sem nome de dono e mtime `0`; gzip sem nome nem data.
- **Unpack:** lê o arquivo inteiro (até `MaxArchiveBytes`) e confere o `--expect-digest` antes de extrair. Rejeita caminho absoluto, `..`, `.`, segmento vazio, `\`, `:`, symlink, hardlink, pasta, device, caminho repetido e destino não vazio. Extrai numa pasta temporária irmã e só troca pelo destino depois de todas as checagens. Um arquivo recusado não deixa nada no destino.
- **Limites:** `pack`, `unpack`, `digest` e `validate` usam as mesmas constantes (`pkg/limits.go`). O `pack` mede o conteúdo final, depois do `generate`.

## Dependência

Só a biblioteca padrão, mais [`go.yaml.in/yaml/v3`](https://github.com/yaml/go-yaml) para ler o frontmatter YAML de agents e skills. É a continuação mantida pela organização YAML do `gopkg.in/yaml.v3`, o parser YAML mais usado em Go. Escrever um parser YAML próprio não seria simples de explicar nem seguro: o contrato aceita listas em bloco e em linha, e o tipo de cada valor importa (`name: true` não é texto).

## Ferramentas locais da demo

Graphify e deja-vu também podem ser conectores MCP locais curados. O executável
upstream fica fora do pacote. `mcp.json` continua proibindo comandos arbitrários;
o gerador aceita somente `extensions["dev.smartharness"].local_connector` com
`graphify` ou `deja-vu`, igual ao nome do pacote. Não admite hooks ou scripts.
O relatório registra componente `kind: mcp`; `.mcp.json` contém exclusivamente
`${HARNESS_CLI_BIN} tools serve <nome>`. Um pacote local não pode combinar essa
extensão com outros servidores em `mcp.json`.

Agentes podem referenciar conectores instalados em outros pacotes por
`connector:github`, `connector:trello`, `connector:notion`, `connector:graphify` ou
`connector:deja-vu`. O adapter gera `mcp__plugin_<conector>_<conector>__*`, preservando
hífens conforme a normalização Claude existente. `mcp:<servidor>` continua exigindo
servidor declarado no próprio pacote. URLs de gateway podem usar `/mcp/me/<conector>`
ou a rota legada `/mcp/projects/<projeto>/<conector>`.

```sh
harness login --api-url http://127.0.0.1:8080
harness tools install graphify deja-vu
harness tools check
```

Para o setup legado, o projeto deve oferecer os dois opcionais no setup-plan. `setup` e `sync` recusam
os pacotes selecionados sem os binários gerenciados na versão fixada; `doctor`
também verifica as ferramentas dos pacotes instalados. A presença no PATH não basta.

Pré-requisitos: `uv` e Python 3.10+ para Graphify; Go 1.25+ para deja-vu; rede para
instalar fontes/dependências. Não há instalação automática de uv/Go. O instalador
usa apenas dois comandos curados: `uv tool install --force "graphifyy[mcp]==0.9.56"` e
`go install -ldflags="-X main.version=0.16.8" github.com/vshulcz/deja-vu/cmd/deja@v0.16.8`.
Os diretórios UV_TOOL_DIR/UV_TOOL_BIN_DIR/GOBIN são isolados em
`HARNESS_CONFIG_DIR/tools/<nome>/<versão>` (padrão `~/.config/smart-harness`).
Instaladores, execução CLI/MCP e probes de versão/import recebem somente uma
allowlist explícita de variáveis de runtime, sistema e caminhos de fontes locais.
Tokens do harness, `ANTHROPIC_*`, GH/GitHub, AWS e credenciais de serviços não são
repassados pelo ambiente. PATH, caches Go/uv e diretórios gerenciados permanecem
disponíveis. Isso não é um sandbox: HOME é herdado sem alteração e os processos
continuam podendo ler arquivos locais e acessar a rede. Funcionalidades upstream
que exigem chaves de serviços no ambiente não recebem essas chaves do harness.

Nenhum `graphify install` ou `deja install` é executado; configurações existentes do
Claude Code e ferramentas globais permanecem intactas. As dependências transitivas
do Python seguem os limites upstream; somente a versão principal é fixada.

Instalação repetida verifica a versão e não muda nada. Um marcador é gravado somente
após o binário responder a versão esperada. Instalação incompleta nunca é anunciada
como pronta; repita o comando para reparar. A instalação tem timeout de dez minutos
sem retry automático e usa o lock do harness. Após encerramento forçado, o próximo
comando informa o lock remanescente. A execução também tem timeout de dez minutos;
falha upstream retorna exit 1, uso incorreto retorna 2.

O índice e as notas do deja-vu ficam em `HARNESS_CONFIG_DIR/deja-index` e
`HARNESS_CONFIG_DIR/deja-notes.jsonl`. `DEJA_INDEX_DIR` e `DEJA_NOTES_FILE` permitem
sobrescrever esses destinos. **Índice isolado não isola fontes:** upstream descobre
históricos locais de coding agents. Use perfil dedicado para uma demo sem histórico
privado. Busca lexical com `--no-embed` e Graphify `update ./src` não precisam de LLM.

Consulte [decisão, fontes e reprodução](../marketplace/local-tools/README.md).

## Jornada pessoal

```sh
harness login --api-url http://127.0.0.1:8080
harness tools check
harness skills check
harness doctor
```

`login` pede o token sem eco, valida `GET /v1/me` e percorre todas as páginas de
`GET /v1/me/setup-plan`. Instala automaticamente os Tools e Skills autorizados,
preservando seleções anteriores; não instala Agents. Repetir o comando mantém
pacotes intactos sem baixar novamente. Graphify/deja-vu usam os runtimes fixados.
Se faltar uv/Python ou Go, configura os demais pacotes, mantém o login e retorna
exit 1 com o nome pendente e o comando `harness tools install <nome>` para completar.
Uma falha parcial nunca imprime que toda a configuração está pronta.

No repositório, escolha a sessão:

```sh
claude                          # sua conta e configuração nativas
harness vendor=claude            # OpenRouter via gateway, modelo openrouter/free
harness vendor=claude --model openrouter/other-model
```

O launcher exige Claude Code instalado e token/gateway obtidos por `harness login`.
Encaminha os argumentos, diretório atual, stdin/stdout/stderr e exit code ao Claude.
O token vai somente ao ambiente do processo filho e a um arquivo temporário de
settings `0600`, removido ao encerrar a sessão, sem aparecer nos argumentos.
Esse overlay de sessão impede que `env` de settings pessoais/projeto substitua o
roteamento solicitado; também desativa os seletores Bedrock/Vertex/Foundry somente
nessa sessão. Não contém a chave OpenRouter: ela permanece no servidor. A flag
`--settings` é reservada pelo launcher e recusada com orientação para usar `claude`
quando precisar de settings próprios. Políticas managed do Claude continuam tendo
precedência. SIGKILL ou queda da máquina podem impedir a remoção do temporário.

Para Graphify, crie o grafo
com `harness tools run graphify update ./src` antes de conectar seu MCP.

O login não precisa do executável Claude nem de plugin instalado. Não existe flag de token.
As credenciais permanecem em `settings.json`, com modo 0600 e backup do conteúdo
anterior. Configurações de outros plugins e permissões são preservadas. O CLI também
grava `HARNESS_CLI_BIN`, `HARNESS_CONFIG_DIR` e `HARNESS_CLAUDE_DIR` absolutos no env
do Claude para os MCPs encontrarem o mesmo executável e ferramentas gerenciadas.
O executável deve ficar em um caminho estável após o login; movê-lo exige novo login
ou sync. Configurações com pacotes/projetos não podem trocar silenciosamente de API.

`personal_plugins` é uma lista aditiva no config: `harness tools install notion` preserva
os demais pacotes selecionados e os projetos legados. `null`/campo ausente identifica
config legado; `[]` indica login pessoal ainda sem pacotes. `sync` e `doctor` unem
as duas seleções e recusam digests/gateways incompatíveis antes de mudar arquivos.
O plano pessoal é paginado por `/v1/me/setup-plan?cursor=...`; cursor repetido ou mais
de 100 páginas falha explicitamente. Pacote pessoal ausente do catálogo impede a
reconciliação, sem apagar a instalação anterior.

`tools install`, `skills install` e `agents install` exigem login e validam a categoria de todos os
nomes no setup-plan antes de alterar pacotes, runtimes ou configuração. Um nome da
categoria errada recusa o lote inteiro. Pacotes mistos seguem a precedência do
catálogo: Agents, Tools (MCP), Skills. `agents install` disponibiliza pacotes com agentes, inclusive pacotes mistos com Tools e Skills. Agents exigem instalação explícita.
`harness install` permanece como alias legado sem filtro de categoria.

Ao selecionar Graphify ou deja-vu em `tools install`, o CLI instala automaticamente
o runtime upstream fixado antes do pacote. Os pré-requisitos uv/Python ou Go
precisam estar disponíveis; ausência retorna erro acionável. Graphify requer o extra
upstream MCP, verificado por import; uma instalação anterior apenas CLI é atualizada
pelo mesmo comando. Outros pacotes não executam instaladores upstream.

`tools check`, `skills check` e `agents check` verificam a integridade somente dos pacotes instalados
na categoria. Cada categoria também verifica os runtimes locais incluídos em seus pacotes;
não exige Graphify/deja-vu quando ausentes. Categoria sem pacotes informa `empty`,
sem declarar instalações saudáveis. Os checks funcionam sem API; `doctor` mantém o
diagnóstico completo de autenticação, settings e gateway.

`tools serve` usa os binários gerenciados, sem shell e sem timeout fixo da sessão:
Graphify roda o Python de seu ambiente com `-m graphify.serve`; deja-vu roda `deja mcp`.
Stdin/stdout são preservados exclusivamente para o protocolo. SIGINT/SIGTERM encerram
o subprocesso. Graphify procura `graphify-out/graph.json` ou
`src/graphify-out/graph.json` no checkout atual; ausência gera instrução de construir
o grafo com `harness tools run graphify update ./src` e reconectar o MCP.
O índice/notas de deja-vu usam os mesmos destinos de `tools run`. As fontes locais
continuam pertencendo ao upstream: o escopo de leitura deve ser isolado pelo ambiente
de QA quando não puder acessar histórico pessoal.


## Criar e publicar no GitHub

```sh
harness new tool example-tool
harness new skill example-skill
harness new agent example-agent --directory ./agent-project
cd agent-project
harness validate package
harness generate package --target claude-code
harness validate package
harness pack package -o ../example-agent-1.0.0.tar.gz
```

`new` cria um repositório de autoria: `package/` contém o núcleo Agent Plugins,
`README.md` explica a publicação e `.github/workflows/release.yml` valida PRs internos
e publica tags `v*`. O comando não cria repositório remoto nem faz login.
O destino deve estar ausente ou vazio, com a pasta pai existente. Arquivos e
symlinks no destino são recusados. O nome usa 1–64 caracteres, começa por letra
minúscula e aceita letras minúsculas, números e hífens simples; os nomes reservados
pelo validador também são recusados. Falha de validação não publica um scaffold parcial.

O workflow usa o CLI oficial `v0.2.3`, verifica `SHA256SUMS`, valida o pacote,
gera a camada Claude Code e publica `<name>-<version>.tar.gz` com `SHA256SUMS`.
A tag precisa ser `v` seguida da versão do manifesto. Código → PR → merge → tag →
GitHub Release → sincronização no Marketplace. O pacote fica no GitHub; SQLite
registra catálogo, proveniência e permissões na plataforma.

Se `nelsonfrugeri-tech/smart-harness` estiver privado, configure o secret
`HARNESS_RELEASE_TOKEN` com leitura de seus Releases. O `GITHUB_TOKEN` do novo
repositório não concede acesso a outro repositório privado. Esse secret só é
passado à etapa de download do CLI. PRs de forks não executam esse workflow;
valide localmente antes de integrar. O scaffold de Tool aponta para uma rota de
gateway ainda a implementar/configurar; `validate` confirma o formato, não a
existência ou saúde da integração.

Um Agent pode incluir os MCPs remotos em `mcp.json` e os dois runtimes locais curados:

```json
{"extensions":{"dev.smartharness":{"local_connectors":["graphify","deja-vu"]}}}
```

`local_connectors` é uma lista não vazia, sem duplicatas, restrita a `graphify` e
`deja-vu`. Pode coexistir com os servidores remotos, cujos nomes devem ser distintos.
A extensão singular `local_connector` continua válida para os pacotes antigos;
as duas formas são mutuamente exclusivas. Nenhuma delas aceita comandos arbitrários.
Agentes do mesmo pacote referenciam `mcp:graphify`, `mcp:deja-vu` e os servidores
remotos declarados, gerando o namespace do próprio pacote. `agents install` prepara
os runtimes presentes nos componentes e `agents check`, `sync` e `doctor` verificam
sua disponibilidade. MCPs de pacotes previamente instalados mantêm seus namespaces.

Fontes do workflow: [eventos do GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
e [gh release create](https://cli.github.com/manual/gh_release_create), consultados em 2026-10-22.
