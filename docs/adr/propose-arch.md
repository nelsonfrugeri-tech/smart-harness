# ADR-0001 — Arquitetura do backend do Smart Harness

- **Status:** Proposed
- **Data:** 2026-10-20
- **Decisores:** Arquitetura de Plataforma (autor), Product Owner, Engenharia de Plataforma, Engenharia de IA
- **Diagrama:** `docs/arch/propose.excalidraw`

## Contexto

O Smart Harness é uma plataforma multi-tenant em que cada squad publica o pacote de capacidades do seu projeto para coding agents: o agente do projeto, as skills de boas práticas e as integrações MCP. Um desenvolvedor novo instala o pacote base e começa a trabalhar com contexto, sem configurar credenciais de serviços nem chaves de modelo. Ele também cria capacidades próprias e propõe a publicação, que passa por validação, sandbox e aprovação.

O formato do pacote é o padrão aberto **Agent Plugins**. O cliente suportado na Fase 1 é o Claude Code; o desenho vale para outros coding agents. O frontend (SPA React) existe como protótipo com dados estáticos e passará a consumir a API descrita aqui.

## Drivers

- Reduzir o tempo até o primeiro trabalho útil de um desenvolvedor novo.
- Governança: revisão, aprovação por quatro olhos, versões imutáveis, rollback e auditoria.
- Isolamento entre squads aplicado no backend, não só na interface.
- Portabilidade: núcleo em padrão aberto, adaptação gerada por cliente, gateway independente do coding agent.
- Segurança: validação de formato, nenhum segredo no pacote, todo acesso a MCPs e modelos passa pela plataforma.
- Simplicidade: cada componente tem uma responsabilidade clara e pode ser verificado de ponta a ponta.

## Opções consideradas

| Decisão | Opções | Escolha |
|---|---|---|
| Fonte da verdade | Banco para tudo · Git para tudo · dividida | **Dividida**: Postgres guarda a governança; Git guarda o conteúdo publicado |
| Formato do pacote | Só o formato do Claude Code · Agent Plugins + camada Claude Code gerada · dois artefatos | **Agent Plugins + camada Claude Code gerada** no mesmo diretório |
| Distribuição | Marketplace git por squad · marketplace único da organização · npm | **Marketplace único `smart-harness`**, versão fixada por SHA; visibilidade aplicada pelo catálogo |
| Visibilidade de capacidades | Tudo público · tudo por squad · campo por capacidade | **Campo `visibility`: `squad` (padrão) ou `organization`** |
| Persistência | Postgres com RLS · SQLite · MongoDB | **Postgres com RLS** |
| Linguagens | Tudo em Go · tudo em Node · Node na API e Go no engine e CLI | **Node na API; Go no engine de pacotes e no CLI** |
| Acesso a MCPs e modelos | Direto do coding agent, com credenciais do dev · gateway da plataforma | **Agent Gateway** para MCPs e modelos |
| Integração com GitHub | Webhooks · outbox + polling | **Outbox + polling** |
| Autenticação | OIDC corporativo · stub local | **Stub na Fase 1**, com porta para OIDC |

## Decisão

1. **Duas linguagens, uma fronteira clara.** A **API e o worker** são Node/TypeScript: tenants, catálogo, contribuições, aprovações, Agent Gateway e integração com o GitHub. Compartilham tipos com o front. O **engine de pacotes e o CLI `harness`** são Go: um binário estático que valida o pacote, gera a camada do Claude Code e roda na máquina do dev, no CI e no servidor. O validador existe uma vez: a API e o CI chamam `harness validate --json`.

2. **Pacote no formato Agent Plugins.** O núcleo tem `plugin.json`, `mcp.json` e `skills/`. Os agents ficam numa extensão com namespace próprio, porque a spec v1 define só skills e MCPs. A camada do Claude Code (`.claude-plugin/`, `.mcp.json`, `agents/`) é gerada a partir do núcleo, de forma determinística. O validador aplica três famílias de regras: spec Agent Plugins, spec Agent Skills e políticas da plataforma (sem segredos, só MCPs do catálogo).

3. **Agent Gateway: a única porta de saída do agente, para MCPs e para modelos.**
   - **MCPs.** Os MCPs do pacote apontam para o gateway. Ele autentica o dev com o token da plataforma, verifica tenant e projeto, injeta a credencial do serviço no lado do servidor e repassa a chamada ao MCP real (GitHub, tracker, docs). A permissão é por recurso: cada projeto declara os repositórios, boards e páginas permitidos, e o gateway valida os argumentos da tool contra essa lista. Os MCPs do pacote base já vêm ativados para o dev. Ele também serve as tools de contexto do projeto.
   - **Modelos.** O coding agent aponta para o gateway por configuração (`ANTHROPIC_BASE_URL` no Claude Code; `model_providers` no Codex). Na Fase 1, um proxy fino valida o token do dev, injeta a chave da organização, repassa ao provedor e registra o uso: `user_id`, harness (Claude Code, Codex, Cursor…), provedor e modelo, tokens de entrada e saída, data, duração e status. O harness é informado pela configuração do cliente; o modelo é o encaminhado. Atribuição por projeto é evolução. Sem roteamento entre provedores, cache ou rate limit.
   - **Credenciais.** Na Fase 1, o gateway guarda uma credencial de serviço por MCP e uma chave de modelo por organização, em variáveis de ambiente. A evolução é credencial delegada do próprio dev (OAuth do GitHub, Atlassian, Notion), sem mudança no pacote nem no fluxo.
   - Toda chamada de tool e de modelo é auditada. Memory as a Service (Fase 2) entra atrás desta mesma porta.

4. **Postgres com Row Level Security por `tenant_id`**, mais escopo de tenant obrigatório na aplicação. Guarda identidade, papéis (ADMIN e DEV), rascunhos, contribuições, aprovações, pacote base por projeto, permissões do gateway, uso de modelos e auditoria. Recurso de outro tenant responde 404; a única exceção é a leitura de versões publicadas com `visibility: organization`.

5. **Catálogo, visibilidade e distribuição.** O repo de catálogo é separado, com layout `plugins/<tenant>/<plugin>/` e **um marketplace `smart-harness` para a organização**. Cada agente e skill tem `visibility`: `squad` (padrão na criação) ou `organization`. A visibilidade vale só para **versões publicadas**: rascunhos, aprovações e escrita ficam sempre na squad dona, e o rascunho pertence ao usuário. A visibilidade é aplicada pela API e pelo setup-plan: o catálogo e o comando de instalação só mostram o que o dev pode ver. O conteúdo do repo é legível pela organização; isolamento de conteúdo por tenant é evolução. Publicar é um commit que fixa o SHA da versão; rollback é um commit que repõe o SHA anterior. GitHub Actions valida cada contribuição com `harness validate`, `claude plugin validate`, varredura de segredos e evals em sandbox. Contribuições não podem conter hooks nem executáveis; os evals rodam em runner efêmero, sem segredos além de uma chave de API dedicada, com limite de custo estimado (`--max-cost-usd`; execuções já iniciadas podem ultrapassá-lo).

6. **Pipeline de contribuição:** rascunho → PR → validação → sandbox → aprovação (ADMIN diferente do autor) → publicado como complemento opcional, com a visibilidade escolhida. Entrar no pacote base é decisão explícita do ADMIN. A aprovação referencia o SHA do PR e o digest do artefato; a publicação entrega exatamente esse conteúdo, e qualquer commit posterior invalida testes e aprovação. Todo efeito externo vai para um outbox; o worker executa com idempotência e retomada, e acompanha o GitHub por polling, sem webhook.

7. **Autenticação e segredos.** Na Fase 1, o login é um stub que emite JWT local, habilitado só em ambiente local; a autorização é real, por membership, a cada requisição. A evolução é OIDC, sem mudar o modelo de autorização. O dev usa um acesso que já tem como membro da organização: leitura do repo de catálogo no GitHub. Além dele, configura um único segredo: o token do Agent Gateway, que serve para MCPs e modelos. Nenhuma credencial de serviço nem chave de modelo fica no pacote ou na máquina do dev.

8. **Observabilidade:** logs JSON com `correlation_id`, `/metrics`, `/healthz` e `/readyz`. Uso de modelos por tenant sai do gateway. Implantação da Fase 1 em docker compose; evolução para Kubernetes.

## Consequências

**Positivas**
- Onboarding com um comando e um único segredo: o gateway cuida de serviços e modelos.
- Uso de modelos por dev, harness e modelo num lugar só; a organização controla a chave.
- O gateway não depende do coding agent: Claude Code, Codex e outros apontam para a mesma porta.
- Go aparece onde dá vantagem real: binário único para dev, CI e servidor. Node mantém front e API na mesma linguagem.
- O isolamento tem duas camadas (aplicação e banco) e é verificável por teste negativo.

**Negativas**
- Dois toolchains (Node e Go), dois pipelines de build. A API depende do binário `harness` no container.
- O gateway é ponto de passagem obrigatório: se cair, os MCPs e a inferência via plataforma param. Mitigação na Fase 1: o dev pode apontar o coding agent de volta ao provedor.
- Com credencial de serviço compartilhada, o serviço externo vê uma conta só; a auditoria por dev fica na plataforma até a evolução para OAuth delegado.
- Duas fontes da verdade exigem reconciliação e tratamento de divergência.

## Confirmação

- **Hipóteses a validar antes de tudo:** (1) o Claude Code carrega um diretório com `plugin.json` na raiz e `.claude-plugin/plugin.json` juntos; se falhar, o engine gera dois artefatos. (2) O MCP remoto do GitHub aceita a credencial injetada pelo gateway; se falhar, o gateway expõe as tools do GitHub via API REST. (3) O Claude Code funciona de ponta a ponta, com streaming, contra o proxy de modelos do gateway.
- Isolamento: testes negativos de acesso entre tenants na API, no banco (RLS sem escopo retorna zero linhas) e no gateway.
- Gateway: uma identidade autorizada no projeto A que tenta acessar um repositório do projeto B é negada e auditada, mesmo dentro do mesmo tenant.
- Onboarding: numa máquina limpa com acesso ao GitHub da organização, `harness setup` instala o pacote, configura o gateway e o agente responde sobre o projeto sem credencial de serviço nem chave de modelo configurada pelo dev.
- Visibilidade: uma skill `squad` de outra squad não aparece no catálogo nem no setup-plan; uma skill `organization` aparece para todos, mas seus rascunhos e aprovações continuam inacessíveis fora da squad dona.
- Uso: duas sessões do mesmo dev em harnesses diferentes registram `user_id`, harness e modelo corretos.
- Publicação: alterar o pacote depois da aprovação bloqueia a publicação.
- Segredos: varredura de artefatos publicados, logs e relatórios de diagnóstico não encontra credencial.

## Referências

- Agent Plugins — Specification v1.0.0: https://agent-plugins.org/specification
- Agent Skills — Specification: https://agentskills.io/specification
- Claude Code — Plugins: manifest, marketplaces, loading, CLI, evals: https://code.claude.com/docs/en/plugins
- Claude Code — MCP: https://code.claude.com/docs/en/mcp
- Claude Code — LLM gateway: https://code.claude.com/docs/en/llm-gateway
- Codex — Config reference (`model_providers`): https://developers.openai.com/codex/config-reference
- RFC 9457 — Problem Details for HTTP APIs
