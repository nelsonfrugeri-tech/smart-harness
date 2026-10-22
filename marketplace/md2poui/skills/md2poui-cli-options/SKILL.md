---
name: md2poui-cli-options
description: Change or test md2poui CLI arguments and option forwarding while preserving the library overloads, defaults and filesystem error behavior.
---

# Contrato CLI e biblioteca

Use ao alterar `src/bin/md2poui.ts`, `Options` ou a entrada da biblioteca.
Leia [o contrato observado](references/contract.md) e confira a revisão local.
Este pacote fornece conhecimento do repositório; não cria um projeto na plataforma,
não exige Trello/Notion e não executa a tarefa demonstrada antecipadamente.

1. Obtenha critérios de aceite da tarefa e das fontes selecionadas pelo usuário.
   Se houver conector disponível, leia a fonte por ele e cite o resultado. Uma cópia
   local deve ser identificada como tal. Não invente histórico nem acesso remoto.
2. Navegue de `src/bin/md2poui.ts` para `src/index.ts` e `src/options.ts`.
   Use Graphify se estiver disponível entre as ferramentas da sessão; confira nomes
   e schema no catálogo real, sem assumir uma API ou exigir uma CLI específica.
   O grafo auxilia a navegação; o código no commit examinado decide o comportamento.
3. Distinga ausência de uma opção, `false` explícito, string vazia e valor inválido.
   Confira separadamente nome no parser, valor entregue em `argv`, encaminhamento
   para `Options` e default da biblioteca. Não sobrescreva `false` com um default.
4. Preserve os overloads da biblioteca: texto Markdown para HTML e caminho existente
   para geração de arquivos. A validação de caminhos da CLI não deve converter um
   caminho inexistente em texto Markdown por acidente nem quebrar o uso textual.
5. Reproduza pelo processo compilado antes da correção. Escreva teste de subprocesso
   com `process.execPath`, argumentos em array, diretório temporário próprio, exit
   code, stdout/stderr e artefatos esperados. Chamar só a biblioteca não cobre o parser.
6. Para opções booleanas, cubra omitida, positiva e negativa. Para erros de entrada,
   cubra obrigatórios ausentes, origem inexistente e destino que seja arquivo.
   Derive a mensagem/exit e a ausência de saída parcial dos critérios da tarefa;
   não apresente comportamento desejado como já existente no baseline.
7. Rode `npm test` no fork: o pretest compila `src` em `dist` e remove `test/result`.
   Preserve testes existentes. Não atualize dependências ou reescreva o parser sem
   necessidade demonstrada. Exclua `dist`, resultados e grafos do commit.

Consulte deja-vu somente quando uma decisão anterior for relevante e a ferramenta
estiver disponível. Cite IDs realmente recuperados e revalide o histórico no código.
Ausência de ferramenta ou resultado deve ser explícita; continue a análise local útil.
