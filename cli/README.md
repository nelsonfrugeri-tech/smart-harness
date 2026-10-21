# cli

CLI `harness` em Go, com o engine de pacotes: valida o pacote, gera a camada de cada coding agent, calcula o digest e empacota.

O único `go.mod` do repositório fica aqui, então os comandos Go rodam com `go -C cli`.

```bash
go -C cli test ./...
go -C cli build -ldflags "-X main.version=0.1.0 -X main.commit=$(git rev-parse --short HEAD)" -o bin/harness ./cmd/harness
```

A imagem da API (`control-plane/Dockerfile`) compila este binário e o instala em `/usr/local/bin/harness`.

## Comandos

| Comando | Faz | Saída |
|---|---|---|
| `harness version` | Versão e commit | `harness 0.1.0 (commit abc1234)` |
| `harness validate <dir> [--json] [--gateway-origin <url>]` | Aplica as regras abaixo | Relatório JSON ou uma linha por achado |
| `harness generate <dir> --target <nome> [--gateway-origin <url>]` | Valida e grava a camada do target no próprio diretório | Um caminho por arquivo gerado |
| `harness digest <dir>` | Digest do tar.gz que o `pack` gravaria | `sha256:<hex>` |
| `harness pack <dir> -o <arquivo.tar.gz>` | tar.gz reproduzível | O digest |
| `harness unpack <arquivo> <destino> [--expect-digest sha256:<hex>]` | Confere o digest do arquivo e extrai com checagens | O digest |

Exit codes: `0` sucesso; `1` pacote inválido ou operação recusada; `2` uso incorreto ou erro de I/O.

`--gateway-origin` define a única origem aceita para MCPs. O padrão é `http://127.0.0.1:8081`, o gateway do `compose.yaml`. O pacote grava essa origem canônica; na máquina do dev, `SMART_HARNESS_GATEWAY_URL` a substitui.

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

`digest` é o que `harness pack` imprimiria; `""` quando o `pack` recusaria o diretório. `components` lista só os componentes válidos (`agent`, `mcp`, `skill`), ordenados por tipo e nome. Todo achado tem `severity: "error"`. Os achados saem ordenados por `path`, `line` e `code`. `line` é 1-based; `0` quando o defeito não tem linha. `findings` é `[]` quando o pacote é válido. Nenhuma mensagem repete o texto que parece segredo.

```json
{"report_version": "1", "valid": false, "plugin": "example", "version": "1.0.0", "digest": "sha256:…",
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
| `SH-MCP-002` | Plataforma | Sem `stdio`, `command`, `args` nem `cwd` |
| `SH-EXE-001` | Plataforma | Sem hooks: pasta `hooks/`, arquivo `hooks.json` ou campo `hooks` no `plugin.json` ou no frontmatter do `SKILL.md`, escrito ou trazido por merge |
| `SH-EXE-002` | Plataforma | Sem executáveis: `bin/`, `skills/<n>/scripts/`, bit de execução, `#!` ou cabeçalho ELF, Mach-O, PE ou WebAssembly |
| `SH-STR-001` | Plataforma | Só os arquivos do layout acima; sem symlink, arquivo especial, `\` ou `:` no caminho |
| `SH-STR-002` | Plataforma | Arquivo gerado idêntico à saída do gerador |
| `SH-STR-003` | Plataforma | YAML simples no frontmatter de `SKILL.md` e de agente: sem anchor (`&`), alias (`*`), merge key (`<<`), tag explícita (`!!str`, `!x`), chave que não é string, chave repetida em qualquer nível ou segundo documento. JSON de `plugin.json` e `mcp.json` sem chave repetida em nenhum objeto |
| `SH-NAM-001` | Plataforma | Nome não reservado pelo Claude Code: sem `.`, sem prefixo `cc-plugin-` e sem as palavras `claude`, `anthropic` ou `anthropics` |
| `SH-VER-001` | Plataforma | `version` em SemVer e `description` presentes |
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
