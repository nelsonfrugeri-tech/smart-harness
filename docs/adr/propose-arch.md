# ADR-0001 — Arquitetura do backend do Smart Harness

- **Status:** Proposed
- **Data:** 2026-10-20
- **Decisores:** Arquitetura de Plataforma (autor), Product Owner, Engenharia de Plataforma, Engenharia de IA
- **Diagrama:** `docs/arch/propose.excalidraw`

## Contexto

O Smart Harness é uma plataforma multi-tenant em que cada squad publica o pacote de capacidades do seu projeto para coding agents: o agente do projeto, as skills de boas práticas e as integrações MCP. Um desenvolvedor novo instala o pacote base e começa a trabalhar com contexto, sem configurar credenciais de serviços nem chaves de modelo. Ele também cria capacidades próprias e propõe a publicação, que passa por validação e aprovação.

O formato do pacote é o padrão aberto **Agent Plugins**. O cliente suportado na Fase 1 é o Claude Code; o desenho vale para outros coding agents. O frontend (SPA React) existe como protótipo com dados estáticos e passará a consumir a API descrita aqui.

## Drivers

- Reduzir o tempo até o primeiro trabalho útil de um desenvolvedor novo.
- Governança: revisão, aprovação por quatro olhos, versões imutáveis, rollback e auditoria.
- Isolamento entre squads aplicado no backend, não só na interface.
- Portabilidade: núcleo em padrão aberto, adaptação gerada por cliente, gateway independente do coding agent.
- Segurança: validação de formato, nenhum segredo no pacote, todo acesso a MCPs e modelos passa pela plataforma.
- Simplicidade: tudo dentro da plataforma, com três componentes e nenhuma dependência de sistema externo para publicar ou instalar.

## Opções consideradas

| Decisão | Opções | Escolha |
|---|---|---|
| Armazenamento e publicação de pacotes | Repo Git com PR e CI · tudo na plataforma | **Tudo na plataforma**: versões imutáveis no Postgres; Git é evolução |
| Instalação no coding agent | Marketplace do Claude Code · pacote baixado da API e instalado de diretório local | **Download pela API + instalação local** pelo CLI |
| Formato do pacote | Só o formato do Claude Code · Agent Plugins + camada Claude Code gerada · dois artefatos | **Agent Plugins + camada Claude Code gerada** no mesmo diretório |
| Visibilidade de capacidades | Tudo público · tudo por squad · campo por capacidade | **Campo `visibility`: `squad` (padrão) ou `organization`** |
| Persistência | SQLite · Postgres com RLS · MongoDB | **SQLite** na Fase 1; Postgres com RLS é evolução |
| Linguagens | Tudo em Go · tudo em Node · Node na API e Go no engine e CLI | **Node na API; Go no engine de pacotes e no CLI** |
| Acesso a MCPs e modelos | Direto do coding agent, com credenciais do dev · gateway da plataforma | **Agent Gateway** para MCPs e modelos |
| Autenticação | OIDC corporativo · stub local | **Stub na Fase 1**, com porta para OIDC |

## Decisão

1. **Três componentes.** **sm-control-plane** (Node/TypeScript): API, banco SQLite, tenants, catálogo, contribuições, aprovações, versões e distribuição dos pacotes. **sm-agent-gateway** (Node/TypeScript): porta única do agente para MCPs e modelos. **sm-cli** (Go): engine de pacotes e CLI `harness`, um binário estático que valida o pacote, gera a camada do Claude Code e instala na máquina do dev. O validador existe uma vez: a API chama `harness validate --json`. O front (sm-saas) consome a API.

2. **Pacote no formato Agent Plugins.** O núcleo tem `plugin.json`, `mcp.json` e `skills/`. Os agents ficam numa extensão com namespace próprio, porque a spec v1 define só skills e MCPs. A camada do Claude Code (`.claude-plugin/`, `.mcp.json`, `agents/`) é gerada a partir do núcleo, de forma determinística, e só ela referencia o token do gateway; o núcleo nunca contém credencial nem referência a ela. O validador aplica três famílias de regras: spec Agent Plugins, spec Agent Skills e políticas da plataforma (sem segredos, só MCPs do catálogo, sem hooks nem executáveis).

3. **Agent Gateway: a única porta de saída do agente, para MCPs e para modelos.**
   - **MCPs.** Os MCPs do pacote apontam para o gateway. Ele autentica o dev com o token da plataforma, verifica tenant e projeto, injeta a credencial do serviço no lado do servidor e repassa a chamada ao MCP real (GitHub, tracker, docs). A permissão é por recurso: cada projeto declara os repositórios, boards e páginas permitidos, e o gateway valida os argumentos da tool contra essa lista. Os MCPs do pacote base já vêm ativados para o dev. Ele também serve as tools de contexto do projeto.
   - **Modelos.** O coding agent aponta para o gateway por configuração (`ANTHROPIC_BASE_URL` no Claude Code; `model_providers` no Codex). Na Fase 1, um proxy fino valida o token do dev, injeta a chave da organização, repassa ao provedor e registra o uso: `user_id`, harness, provedor e modelo, tokens de entrada e saída, data, duração e status. Atribuição por projeto é evolução. Sem roteamento entre provedores, cache ou rate limit.
   - **Credenciais.** Na Fase 1, o gateway guarda uma credencial de serviço por MCP e uma chave de modelo por organização, em variáveis de ambiente. A evolução é credencial delegada do próprio dev (OAuth do GitHub, Atlassian, Notion), sem mudança no pacote nem no fluxo.
   - Toda chamada de tool e de modelo é auditada. Memory as a Service (Fase 2) entra atrás desta mesma porta.

4. **SQLite, um arquivo, sem serviço de banco.** O isolamento entre tenants é aplicado na camada de acesso a dados: todo repositório exige o escopo do tenant, e isso é coberto por teste negativo. Guarda identidade, papéis (ADMIN e DEV), rascunhos, contribuições, aprovações, versões publicadas (snapshot imutável do pacote e digest), pacote base por projeto, permissões do gateway, uso de modelos e auditoria. Recurso de outro tenant responde 404; a única exceção é a leitura de versões publicadas com `visibility: organization`.

5. **Catálogo, visibilidade e distribuição, tudo na plataforma.** Cada agente e skill tem `visibility`: `squad` (padrão na criação) ou `organization`. A visibilidade vale só para versões publicadas: rascunhos, aprovações e escrita ficam na squad dona, e o rascunho pertence ao usuário. A API aplica a visibilidade no catálogo e no setup-plan. A distribuição é um download: `harness setup <projeto>` pede o setup-plan, baixa o pacote base como arquivo da API, grava em um diretório local e instala no Claude Code como plugin de diretório. Rollback é apontar o pacote base para a versão anterior; a próxima execução de `harness setup` ou `harness sync` troca o pacote instalado.

6. **Pipeline de contribuição, todo na API:** rascunho → `harness validate` → teste local pelo dev (`claude --plugin-dir` no rascunho baixado) → envio para aprovação → aprovação por ADMIN diferente do autor → versão imutável publicada no catálogo como complemento opcional, com a visibilidade escolhida. A aprovação referencia o digest do rascunho; qualquer alteração depois disso invalida a aprovação. Entrar no pacote base é decisão explícita do ADMIN. Evolução: exportar versões para um repo Git e executar evals comportamentais em CI antes da aprovação.

7. **Autenticação e segredos.** Na Fase 1, o login é um stub que emite JWT local, habilitado só em ambiente local; a autorização é real, por membership, a cada requisição. A evolução é OIDC, sem mudar o modelo de autorização. O dev configura um único segredo: o token do Agent Gateway, que o CLI grava nas variáveis que o Claude Code lê para MCPs e para o modelo. Nenhuma credencial de serviço nem chave de modelo fica no pacote ou na máquina do dev.

8. **Observabilidade:** logs JSON com `correlation_id`, `/metrics`, `/healthz` e `/readyz`. Uso de modelos por dev, harness e modelo sai do gateway. Implantação da Fase 1 em docker compose (api, gateway, front), com o SQLite em volume; evolução para Kubernetes.

## Consequências

**Positivas**
- Onboarding com um comando e um único segredo; nenhuma dependência de Git, marketplace ou CI externo.
- Uma fonte da verdade: um arquivo SQLite. Sem serviço de banco nem reconciliação entre sistemas.
- Uso de modelos por dev, harness e modelo num lugar só; a organização controla a chave.
- O gateway não depende do coding agent: Claude Code, Codex e outros apontam para a mesma porta.
- Go aparece onde dá vantagem real: binário único para dev e servidor. Node mantém front e API na mesma linguagem.
- O isolamento entre tenants é verificável por teste negativo na API.

**Negativas**
- Dois toolchains (Node e Go). A API depende do binário `harness` no container.
- O gateway é ponto de passagem obrigatório: se cair, os MCPs e a inferência via plataforma param. Mitigação na Fase 1: o dev pode apontar o coding agent de volta ao provedor.
- Com credencial de serviço compartilhada, o serviço externo vê uma conta só; a auditoria por dev fica na plataforma até a evolução para OAuth delegado.
- Sem CI externo, a verificação comportamental de contribuições (evals) fica para a evolução; na Fase 1 a aprovação se apoia na validação do engine e na revisão humana.
- Atualizar o pacote instalado depende de o dev rodar `harness sync`; não há auto-update.
- O isolamento entre tenants fica só na aplicação; não há Row Level Security no banco.

## Fase 1 e evolução corporativa

| Capacidade | Fase 1 (prova de conceito) | Evolução corporativa |
|---|---|---|
| Identidade | Login stub local | IdP corporativo via OIDC |
| Credenciais de serviços | Uma por MCP, no gateway | OAuth delegado por dev (GitHub, Atlassian, Notion) |
| Modelos | Proxy fino, chave da organização, uso por dev | Roteamento entre provedores, limite de custo por squad, atribuição por projeto |
| Publicação | Aprovação na plataforma, versão no Postgres | Exportação para Git, evals comportamentais em CI antes da aprovação |
| Instalação | Download pela API, plugin local, `harness sync` | Distribuição pelas configurações da organização do coding agent, auto-update |
| Clientes | Claude Code | Codex, Cursor e outros, pelo mesmo núcleo Agent Plugins e pelo mesmo gateway |
| Banco | SQLite, isolamento na aplicação | Postgres com Row Level Security por tenant |
| Implantação | docker compose | Kubernetes |
| Memória | Fora do escopo; porta reservada no gateway | Memory as a Service |

## Confirmação

- **Hipóteses a validar antes de tudo:** (1) o Claude Code carrega um diretório com `plugin.json` na raiz e `.claude-plugin/plugin.json` juntos; se falhar, o engine gera dois artefatos. (2) O MCP remoto do GitHub aceita a credencial injetada pelo gateway; se falhar, o gateway expõe as tools do GitHub via API REST. (3) O Claude Code funciona de ponta a ponta, com streaming, contra o proxy de modelos do gateway.
- Isolamento: testes negativos de acesso entre tenants na API, na camada de dados (consulta sem escopo de tenant é rejeitada) e no gateway.
- Gateway: uma identidade autorizada no projeto A que tenta acessar um repositório do projeto B é negada e auditada, mesmo dentro do mesmo tenant.
- Onboarding: numa máquina limpa, `harness setup` instala o pacote, configura o gateway e o agente responde sobre o projeto sem credencial de serviço nem chave de modelo configurada pelo dev.
- Visibilidade: uma skill `squad` de outra squad não aparece no catálogo nem no setup-plan; uma skill `organization` aparece para todos, mas seus rascunhos e aprovações continuam inacessíveis fora da squad dona.
- Publicação: alterar o rascunho depois da aprovação invalida a aprovação; a versão publicada corresponde ao digest aprovado.
- Uso: duas sessões do mesmo dev em harnesses diferentes registram `user_id`, harness e modelo corretos.
- Segredos: varredura de pacotes publicados, logs e relatórios de diagnóstico não encontra credencial.

## Referências

- Agent Plugins — Specification v1.0.0: https://agent-plugins.org/specification
- Agent Skills — Specification: https://agentskills.io/specification
- Claude Code — Plugins (manifest, componentes, instalação de diretório local, CLI): https://code.claude.com/docs/en/plugins
- Claude Code — MCP: https://code.claude.com/docs/en/mcp
- Claude Code — LLM gateway: https://code.claude.com/docs/en/llm-gateway
- Codex — Config reference (`model_providers`): https://developers.openai.com/codex/config-reference
- RFC 9457 — Problem Details for HTTP APIs
