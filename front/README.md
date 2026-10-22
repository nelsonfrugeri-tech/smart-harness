# Smart Harness — frontend

Interface pessoal em React + TypeScript + Vite. Perfil e tokens, Marketplace de
Tools/Skills/Agents, Workspace vazio e uma jornada guiada para a CLI.
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
- **Marketplace:** Todos, Tools, Skills e Agents usam `type` da API.
  Keywords viram links de busca textual `q`; não indicam correspondência exata.
  Filtros e busca permanecem na URL; mudanças reiniciam cursor e cancelam requests.
  Origem e GitHub vêm dos campos opcionais `source` e `related_project`. O detalhe
  separa a autoria do pacote do projeto relacionado: um pacote interno pode
  integrar um projeto open source. Registros legados não recebem origem presumida;
  links aceitam somente repositórios HTTPS do GitHub, sem credenciais ou parâmetros.
- **Workspace:** tela vazia, sem projetos ou atividades de demonstração. Não busca
  o workspace antigo para montar essa superfície. URLs antigas de projetos
  permanecem acessíveis, sem entrar na navegação principal.
- **CLI:** token → um comando para instalar e conectar → diagnóstico →
  desenvolvimento/review. Pré-requisitos ficam recolhidos; não há progresso
  simulado nem confirmação de instalação pelo clipboard.

A API serve `curl -fsSL '<API>/install' | sh`, os binários macOS/Linux ARM64/x64 e
`SHA256SUMS`, sem depender de uma release GitHub. Windows usa WSL. Os comandos
estão centralizados em `src/app/cliCommands.ts`. URLs com credenciais, query,
fragmento ou HTTP fora de loopback não geram comandos.

O instalador exige Claude Code e curl no PATH. O login lê o token pelo prompt
seguro, configura o gateway e instala os Tools/Skills autorizados. Não há segundo
login na Anthropic. Graphify requer uv/Python ≥ 3.10 e deja-vu requer Go ≥ 1.25.
Instalação parcial preserva o login e os pacotes disponíveis, retorna falha e
orienta a recuperação no terminal; a página não a anuncia como concluída.
Se instalou Graphify, gere o grafo dentro do checkout antes
de abrir o Claude Code: `harness tools run graphify update ./src`. Ajuste a pasta
de fontes quando necessário. O MCP procura `graphify-out/graph.json` ou
`src/graphify-out/graph.json` no diretório de execução; se a sessão já estiver
aberta, reconecte o MCP após a geração.

O conjunto recomendado contém somente github, trello, notion, graphify, deja-vu,
md2poui e code-review. Nesta demo, abra o Claude Code com
`claude --model openrouter/free`. O login da CLI não fixa o modelo; o argumento
da sessão escolhe o modelo encaminhado pelo gateway. Para review independente,
repita esse comando em outro terminal no mesmo repositório; dentro dessa sessão,
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
3. Filtrar Agents por teclado; abrir pacote e retornar preservando a consulta.
4. Abrir CLI e conferir o comando único e os pré-requisitos recolhidos.
5. Informar URL com credenciais ou HTTP externo: comando de instalação desaparece e
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
