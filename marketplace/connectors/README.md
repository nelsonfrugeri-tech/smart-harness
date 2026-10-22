# Conectores pessoais

O catálogo inicial oferece GitHub, Trello e Notion como MCPs remotos, e Graphify e
deja-vu como MCPs locais. Todos têm a tag `claude-code` e componentes do tipo `mcp`.

- Remotos: o adaptador gera `/mcp/me/<nome>` com as variáveis
  `SMART_HARNESS_GATEWAY_URL` e `SMART_HARNESS_TOKEN`. O gateway resolve o usuário
  pelo token e aceita somente recursos concedidos a ele em uma membership vigente.
- Locais: a extensão `dev.smartharness.local_connector` escolhe um dos dois nomes
  permitidos pelo engine. O adaptador gera `${HARNESS_CLI_BIN} tools serve <nome>`.
  O pacote não define comandos arbitrários, hooks, credenciais ou executáveis.

Gere os cinco arquivos com `node marketplace/build-connectors.mjs cli/bin/harness`.
Os arquivos são imutáveis: mudar os bytes exige uma versão nova. As versões 1.0.0
anteriores de Graphify/deja-vu permanecem disponíveis como fixtures legadas; os
conectores MCP pessoais usam a versão 2.0.0.

`make check-marketplace` valida, gera e empacota as fontes novamente, compara os
arquivos publicados e testa que uma publicação existente não seja sobrescrita.
