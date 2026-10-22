# Smart Harness — frontend

Interface pessoal em React + TypeScript + Vite. Perfil e tokens, Marketplace de
Conectores/Skills/Agentes, Workspace vazio e uma jornada guiada para a CLI.
Os dados de identidade, pacotes e credenciais vêm da API; copiar comandos não
confirma instalação nem conexão.

## Rodar

Com API disponível em `http://127.0.0.1:8080`, na pasta `front`:

```sh
npm ci --no-audit --no-fund
npm run dev -- --port 5173
```

Em outra instância:

```sh
HARNESS_API_TARGET=http://127.0.0.1:18280 HARNESS_PUBLIC_API_URL=http://127.0.0.1:18280 npm run dev -- --port 15282 --strictPort
```

`HARNESS_API_TARGET` configura o proxy `/v1`. `HARNESS_PUBLIC_API_URL` é o endereço
sugerido para o terminal. Use explicitamente a URL pública quando o proxy aponta
para um hostname interno. Nenhum dos dois deve conter credenciais.

O login por email depende de `APP_ENV=local` no backend. Fora desse ambiente, a
interface informa a indisponibilidade; integração OIDC não faz parte desta tela.

## Jornada pessoal

- **Perfil:** nome e email reais; cargo usa `job_title` quando disponível. Ausência
  aparece como “Não informado”, sem simular papel profissional ou permissão.
  Tokens reutilizam criação, exibição única, paginação e revogação existentes.
- **Marketplace:** Todos, Conectores, Skills e Agentes usam `type` da API.
  Keywords viram links de busca textual `q`; não indicam correspondência exata.
  Filtros e busca permanecem na URL; mudanças reiniciam cursor e cancelam requests.
  Origem e GitHub vêm dos campos opcionais `source` e `related_project`. O detalhe
  separa a autoria do pacote do projeto relacionado: um pacote interno pode
  integrar um projeto open source. Registros legados não recebem origem presumida;
  links aceitam somente repositórios HTTPS do GitHub, sem credenciais ou parâmetros.
- **Workspace:** tela vazia, sem projetos ou atividades de demonstração. Não busca
  o workspace antigo para montar essa superfície. URLs antigas de projetos
  permanecem acessíveis, sem entrar na navegação principal.
- **CLI:** token → download por sistema/arquitetura → login da CLI → Claude Code
  → ferramentas e plugins → diagnóstico → desenvolvimento/review. Etapas podem
  ser acessadas diretamente, sem bloqueio nem progresso simulado.

A release referenciada é `v0.2.0`, com binários macOS/Linux ARM64 e x64 e
`SHA256SUMS`. Windows usa o binário Linux no WSL. A UI não oferece binário nativo
Windows. O mantenedor precisa publicar a release antes de usar os links da tela.
Os comandos estão centralizados em `src/app/cliCommands.ts`.

`harness login --api-url '<url>'` recebe o token pelo prompt seguro. Nesta jornada,
o gateway Smart Harness fornece a autenticação do Claude Code; um segundo login
na Anthropic não é solicitado. Graphify/deja-vu precisam das ferramentas locais
antes da instalação dos plugins. A interface mostra os pré-requisitos e os
comandos nessa ordem. Se instalou Graphify, gere o grafo dentro do checkout antes
de abrir o Claude Code: `harness tools run graphify update ./src`. Ajuste a pasta
de fontes quando necessário. O MCP procura `graphify-out/graph.json` ou
`src/graphify-out/graph.json` no diretório de execução; se a sessão já estiver
aberta, reconecte o MCP após a geração.

O conjunto recomendado contém somente github, trello, notion, graphify, deja-vu,
md2poui e code-review. Abra o Claude Code com `claude`. Para review independente,
execute `claude` em outro terminal no mesmo repositório; dentro dessa sessão,
use `/code-review:code-review` e indique o diff/PR. O prefixo é o nome do plugin
`code-review`; o segundo nome vem de `skills/code-review/SKILL.md`.

## Verificar

```sh
npm run check
```

O gate executa contrato → formato → lint → testes → TypeScript → build. Para
regenerar o cliente tipado após alterar o contrato da API:

```sh
npm run contract:types
```

O cliente gerado vem de `../control-plane/openapi.json`; não editar
`src/api/schema.d.ts` manualmente. Testes novos ficam em `test/`, espelhando `src/`.

Roteiro de QA com API real:

1. Login, perfil e token; sair/navegar deve remover qualquer segredo em exibição.
2. Abrir Workspace: nenhuma atividade ou projeto fictício deve aparecer.
3. Filtrar Agentes por teclado; abrir pacote e retornar preservando a consulta.
4. Abrir CLI, escolher Linux/x64 e conferir asset `harness-v0.2.0-linux-amd64`.
5. Informar URL com credenciais ou HTTP externo: comando de login desaparece e
   aparece erro. Corrigir a URL restaura o comando sem conter segredo.
6. Copiar comando: mensagem deve confirmar somente a cópia. Executar os comandos
   no terminal e validar seus resultados separadamente.
7. Testar 390, 768 e 1440 px, Tab/Shift+Tab/Enter e Escape no menu mobile.
8. Simular falha de rede no Marketplace/perfil e usar recuperação explícita.

JWT fica em memória e sessionStorage. Logout/401 limpam a sessão; requests antigos
são cancelados. JSON tem timeout de 10 s; downloads de pacotes têm 30 s e conferem
SHA-256 antes de salvar. Não há polling nem retry automático.

## Referências

Documentação oficial consultada em 22/10/2026:

- [Instalar Claude Code](https://code.claude.com/docs/en/setup)
- [Autenticação do Claude Code](https://code.claude.com/docs/en/authentication)
- [Conectar um gateway](https://code.claude.com/docs/en/llm-gateway-connect)

- [Invocação de skills de plugins](https://code.claude.com/docs/en/skills#choose-where-skills-load)
