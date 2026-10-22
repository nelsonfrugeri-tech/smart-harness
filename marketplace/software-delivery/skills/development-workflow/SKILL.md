---
name: development-workflow
description: Deliver an accepted repository task using the selected domain skills and authorized context connectors, with behavioral checks and an independent review handoff.
---

# Desenvolvimento com contexto selecionado

Use na implementação de uma tarefa com comportamento esperado identificável. Combine
esta sequência com as skills de domínio selecionadas e aplicáveis. O checkout local é
independente da configuração de conta da plataforma; não cadastre um projeto para editar
um repositório de exemplo.

1. Identifique tarefa, repositório e critérios de aceite. Consulte somente os conectores
   selecionados necessários ao pedido: GitHub para código/PR, Trello para história e
   Notion para decisão quando esses recursos fizerem parte da tarefa. Descubra schema e
   ferramentas reais da sessão. Não use endpoints, IDs ou URLs de um exemplo anterior.
2. Cite contexto realmente lido. Se a Spec estiver ausente ou contraditória, pare apenas
   a parte dependente e exponha a lacuna. Não simule leitura, autenticação ou histórico.
3. Confira head, remotes, branch e alterações locais. Preserve trabalho existente e use
   checkout/branch isolado conforme a tarefa. O alvo de publicação deve ser explicitamente
   autorizado; acesso de leitura a upstream não autoriza push nele.
4. Carregue skills selecionadas que correspondam ao código afetado. Use Graphify via MCP
   quando disponível para localizar o fluxo, então confira os arquivos no head. Consulte
   deja-vu via MCP quando uma decisão anterior importar e cite o registro real. Schema e
   nome das ferramentas vêm do catálogo; não invente comandos nem exija instalações CLI
   quando a integração selecionada já fornece essas operações.
5. Descubra checks no Makefile/package/scripts/CI do próprio repositório. Inspecione seus
   efeitos. Para bug, reproduza antes de alterar; para feature, defina observações de
   comportamento, inclusive ausência/erro. Crie teste que falhe pelo requisito ausente
   quando viável. Use entradas independentes da implementação, sem testes espelho.
6. Implemente a menor mudança que atende à tarefa. Preserve API e comportamento fora do
   escopo; não acrescente infraestrutura ou atualize dependências por conveniência.
   Execute primeiro checks focados, depois os gates aplicáveis do projeto.
7. Inspecione diff completo e artefatos. Exclua tokens, sessões, configurações pessoais,
   caches, builds e grafos não solicitados. Relate resultados e limitações concretas.
8. Se publicação foi autorizada, use ferramenta GitHub com escrita realmente disponível
   ou git/gh local autenticado com alvo explícito. Abra PR com comportamento final,
   referências da tarefa, antes/depois e validação. Gateway somente leitura não publica.
9. Entregue PR/head SHA e evidências a outra sessão para review. Reproduza BLOCKER/MAJOR,
   corrija quando sustentado e retorne novo SHA com checks. Discordâncias exigem evidência.
   Não se autoaprove. Após três rodadas ou bloqueio persistente, entregue o impasse ao
   coordenador e continue apenas partes independentes. Merge é uma etapa separada.

A execução do agente não amplia permissões do host nem autoriza transmitir documentos
privados a outro provedor. Respeite o destino/modelo autorizado para o conteúdo da tarefa.
