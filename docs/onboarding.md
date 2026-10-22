# Onboarding pessoal da demo

A jornada é: Perfil → token → um comando no terminal → desenvolvimento → review
independente → merge no fork. O Workspace permanece vazio. O TOTVS md2poui é um
checkout de exemplo e um pacote de Skills, sem projeto cadastrado na plataforma.

## Preparação do mantenedor

Siga o [ambiente local](../README.md#ambiente-local). O seed publica somente sete
pacotes: Tools `github`, `trello`, `notion`, `graphify`, `deja-vu`; Skills
`md2poui` e `code-review`. O filtro Agents fica vazio.

Configure as credenciais dos provedores no gateway e as permissões pessoais
`DEMO_GITHUB_REPO`, `DEMO_TRELLO_BOARD_ID` e `DEMO_NOTION_PAGE_IDS` antes do seed.
Vincule a história no Trello à ADR do Notion. Valide a leitura real desses
recursos e do fork antes da apresentação; um pacote no catálogo não comprova
acesso. A chave do modelo também permanece no gateway.

A imagem da API inclui `/install`, os quatro binários e `SHA256SUMS`. A URL
pública (`PUBLIC_API_URL`) deve ser alcançável pelo desenvolvedor. No frontend,
use o mesmo endereço em `HARNESS_PUBLIC_API_URL`. Não é necessário acessar uma
release privada do GitHub para baixar a CLI.

## Instalar e conectar

1. Entre como `dev@smart-harness.local` na instância local. No **Perfil**, crie um
   token para o dispositivo e guarde o segredo para o prompt do terminal.
2. Tenha Claude Code e curl no PATH. Para Graphify, instale uv e Python ≥ 3.10;
   para deja-vu, Go ≥ 1.25. No Windows, use WSL.
3. Abra **CLI**, confira a URL da plataforma, copie e execute o comando:

```sh
curl -fsSL 'http://127.0.0.1:8080/install' | sh
```

O instalador detecta macOS/Linux e ARM64/x64, verifica SHA-256 antes de trocar o
binário e chama o login. Cole o token no prompt sem eco; não coloque o segredo
no comando. O login configura o gateway, os Tools e as Skills autorizados.
Não há segundo login na Anthropic nesta jornada.

Se houver instalação parcial, siga os comandos de recuperação do terminal.
Credencial e pacotes já configurados permanecem salvos; a CLI retorna falha e
não anuncia que tudo está pronto. Se o instalador ajustar o PATH, siga a
orientação exibida para o terminal atual. Confira depois:

```sh
harness doctor
```

## Desenvolver e revisar

Entre no checkout local do fork md2poui e siga seus comandos de instalação e
testes. Antes de abrir o Claude Code, prepare o grafo local:

```sh
harness tools run graphify update ./src
```

Ajuste `./src` à pasta de fontes. O MCP procura `graphify-out/graph.json` ou
`src/graphify-out/graph.json` na pasta em que o Claude Code é aberto. Se a sessão
já estiver aberta, reconecte o MCP após gerar o grafo. Abra o modelo da demo:

```sh
claude --model openrouter/free
```

Peça a leitura da história do Trello e da ADR vinculada antes da implementação.
Use Graphify para navegar o projeto e deja-vu para recuperar o histórico que
existir. Ausência de histórico deve ser relatada. Implemente a feature e abra o
PR no fork com sua credencial Git; o conector GitHub da demo oferece leitura.

Abra outro terminal no mesmo checkout e repita o comando do Claude Code. Nessa
sessão independente, indique o diff ou PR e invoque:

```text
/code-review:code-review
```

Corrija BLOCKER/MAJOR, execute novamente as verificações afetadas e faça merge
no fork após a revisão.

## Verificar a jornada

No frontend, teste Perfil → CLI, a cópia do comando, expansão dos pré-requisitos,
URL inválida e recuperação. Copiar confirma apenas o clipboard. Teste a navegação
por teclado e as larguras 390, 768 e 1440 px. No terminal, valide o instalador,
o diagnóstico e a leitura real de cada conector. Build e testes DOM não
comprovam essas integrações externas.
