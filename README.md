# Smart Harness

Plataforma para instalar Tools e Skills pessoais no Claude Code. A jornada
atual começa no perfil: login, token pessoal, um comando para instalar e configurar a CLI e os plugins,
e trabalho no repositório local.

## Demo atual

- **Perfil:** nome, e-mail, cargo e tokens pessoais de acesso.
- **Marketplace:** filtros Tools, Skills e Agents. O seed oferece sete
  pacotes: `github`, `trello`, `notion`, `graphify`, `deja-vu`, `md2poui` e
  `code-review`. São cinco Tools e dois pacotes de Skills; Agents está vazio.
- **Workspace:** vazio, sem projetos cadastrados pela demo.
- **CLI:** tela com o passo a passo para configurar o Claude Code e instalar os
  plugins. O fluxo continua no checkout: feature, PR, review independente e merge.

O TOTVS md2poui é o repositório de exemplo e possui um pacote de skills. Ele não
é um projeto no Workspace. As credenciais dos provedores permanecem no gateway;
o token pessoal autentica o acesso do usuário à API e ao gateway.

## Ambiente local

Requer Node 24, Go 1.27, Docker e make. Execute os comandos a partir da raiz deste
repositório.

Na primeira execução, se ainda não existir `.env`:

```bash
cp .env.example .env
```

Revise os valores locais em `.env`. O login por e-mail e o seed exigem
`APP_ENV=local`; não constituem um fluxo de autenticação de produção.

### Se já existe um banco da demo anterior

Mantenha seu `.env` e suas credenciais. Para começar a demo pessoal sem misturar
squads, projetos ou publicações antigas, configure estas linhas no `.env`:

```dotenv
APP_ENV=local
DATABASE_PATH=/data/personal-demo.sqlite
```

API e gateway usam a **mesma variável `DATABASE_PATH`**, no volume compartilhado
`sqlite-data`. Sem essa variável, ou com valor vazio, o padrão continua sendo
`/data/control-plane.sqlite`. O novo caminho cria outro arquivo no mesmo volume;
o banco anterior, seus tokens e o bucket de arquivos permanecem preservados.
Os tokens do banco antigo não são copiados: gere um token no perfil da nova demo.

### Subir API e gateway

Depois de revisar o `.env` e escolher o caminho do banco, reconstrua os serviços
e aplique o seed:

```bash
make up
make seed
```

`make up` reconstrói as imagens e espera os serviços ficarem saudáveis. `make seed`
cria a identidade local e publica os sete pacotes de forma idempotente; não cria
projetos. Se aparecer conflito de propriedade de um pacote antigo, confira o
`DATABASE_PATH` dos dois serviços. Não remova volumes para resolver esse conflito.

Para retornar ao banco anterior, configure
`DATABASE_PATH=/data/control-plane.sqlite` e execute `make up`. Isso seleciona o
arquivo anterior; não mescla bancos nem apaga o arquivo da demo pessoal.

### Abrir o frontend

Com a API em `http://127.0.0.1:8080`, execute:

```bash
npm --prefix front ci --no-audit --no-fund
HARNESS_API_TARGET=http://127.0.0.1:8080 HARNESS_PUBLIC_API_URL=http://127.0.0.1:8080 npm --prefix front run dev -- --port 5173 --strictPort
```

Abra [http://127.0.0.1:5173](http://127.0.0.1:5173) e entre com
`dev@smart-harness.local`. O perfil de exemplo é Alex Morgan, Software Engineer.
Gere o token no Perfil e siga a tela CLI. Com Claude Code e curl no PATH,
execute o comando da sua instância:

```sh
curl -fsSL 'http://127.0.0.1:8080/install' | sh
```

O instalador baixa o binário macOS/Linux ARM64/x64 da própria API, verifica
SHA-256 e pede o token no terminal sem eco. O login configura o gateway e os
Tools/Skills autorizados; Graphify requer uv/Python ≥ 3.10, e deja-vu requer Go
≥ 1.25. Uma instalação parcial preserva os pacotes prontos e informa como
completar. Siga a orientação sobre PATH e confira `harness doctor`.
O roteiro completo está em [onboarding](docs/onboarding.md).

Os serviços padrão são API `8080`,
gateway `8081` e MinIO `9000`, publicados somente em `127.0.0.1`.

Para usar os conectores remotos, configure no `.env` as credenciais do gateway e
as permissões pessoais `DEMO_GITHUB_REPO`, `DEMO_TRELLO_BOARD_ID` e
`DEMO_NOTION_PAGE_IDS`. Depois execute `make up` e `make seed`. Permissão vazia
nega acesso ao recurso; credencial ausente deixa o respectivo servidor desligado.
Graphify e deja-vu executam localmente após a instalação indicada na tela CLI.

O Compose deriva `PUBLIC_API_URL` de `API_PORT` (padrão `8080`). Configure
`PUBLIC_API_URL` explicitamente para outro endereço público e use o mesmo valor
em `HARNESS_PUBLIC_API_URL` no frontend. `INSTALLER_VERSION` (padrão `v0.2.1`)
controla a versão dos downloads na imagem e na API; `HARNESS_VERSION` pode ser
`dev` sem mudar os nomes dos assets. Fora do Docker, a API exige
`INSTALLER_ASSETS_DIR` explícito; sem assets, `/install` responde 503.

```bash
make check  # Runs the repository checks.
make down   # Stops services and preserves sqlite-data and minio-data.
```

## Estrutura

| Pasta | Conteúdo |
| --- | --- |
| `control-plane/` | API, identidade, catálogo e seed pessoal em Node/TypeScript |
| `agent-gateway/` | Gateway de MCPs e modelos em Node/TypeScript |
| `cli/` | CLI `harness` em Go |
| `front/` | Perfil, Marketplace, Workspace e guia da CLI |
| `marketplace/` | Fontes dos pacotes e builders reproduzíveis |
| `examples/` | Contexto do repositório de exemplo e fixtures legadas |
| `docs/` | ADRs e contratos |

Detalhes: [frontend](front/README.md), [API](control-plane/README.md),
[gateway](agent-gateway/README.md) e [CLI](cli/README.md).
As entregas são acompanhadas nas
[GitHub Issues](https://github.com/nelsonfrugeri-tech/smart-harness/issues).
