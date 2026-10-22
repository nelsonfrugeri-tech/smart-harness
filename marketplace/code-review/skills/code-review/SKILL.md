---
name: code-review
description: Independently review a current diff against repository standards and task acceptance criteria, reporting only evidenced BLOCKER or MAJOR findings.
---

# Code review independente

Use para revisão em sessão independente do autor. Leia o
[contrato e a origem](references/review-contract.md). Esta skill é geral: não exige
repositório, workspace, linguagem ou conjunto de conectores específico.

1. Resolva o diff solicitado, base e head exatos. Para PR, obtenha target e head pela
   ferramenta GitHub disponível ou `gh pr view` autorizado; calcule o merge base.
   Para alterações locais, diferencie staged, working tree e untracked. Sem diff
   inspecionável, marque revisão incompleta e não aprove.
2. Obtenha a Spec: pedido explícito, história/issue, critérios de aceite e ADR pertinente.
   Use apenas fontes selecionadas/autorizadas. Leia Trello/Notion se fizerem parte da
   tarefa e estiverem disponíveis; cite URL/ID realmente retornado. Sem Spec material,
   marque o eixo não avaliado, sem completar lacunas por suposição.
3. Leia o diff inteiro e o contexto necessário. Carregue as skills de linguagem/domínio
   selecionadas que se aplicam ao código. Graphify disponível ajuda a localizar callers;
   revalide o grafo no código. Consulte deja-vu para decisão anterior pertinente, cite
   o registro e revalide fatos mutáveis. Nenhuma ferramenta ausente vira leitura fictícia.
4. Avalie separadamente Standards (contratos do repositório, correção, segurança,
   compatibilidade e checks) e Spec (comportamento e critérios da tarefa). Um teste
   passando não prova atendimento a um requisito que ele não exercita.
5. Execute os checks pertinentes em checkout isolado e reproduza cada achado material.
   Inspecione efeitos antes de rodar comandos. Preserve o ambiente do autor. Falta de
   dependência ou acesso limita a revisão; não altere o produto para torná-la verde.
6. Relate somente BLOCKER/MAJOR demonstrados: arquivo/linha no head examinado, eixo,
   efeito concreto, reprodução/evidência, correção mínima e verificação. Não publique
   sugestões cosméticas, problemas hipotéticos sem evidência ou falhas roteirizadas.
7. Publique comentários somente quando a tarefa autorizar, com alvo explícito. Use a
   ferramenta que realmente ofereça escrita; um conector GitHub somente leitura não
   publica review. `gh pr review --repo <alvo> --comment --body-file <arquivo-temporário>`
   é alternativa local quando disponível/autenticada. Se usar a mesma conta do autor,
   não tente self-approval/request-changes nem troque identidade. Não exponha credenciais.
8. Antes de publicar, confira o head remoto novamente. Se mudou, revise o delta e rode
   checks afetados. Após correções, reexecute a reprodução no novo SHA e atualize o
   veredito. Não resolva discordância por autoridade: compare a evidência.

Zero achados é resultado legítimo. Não crie trabalho para justificar a revisão. Qualquer
BLOCKER/MAJOR pendente impede a disposição de pronto para aceite. Após três rodadas sem
resolver, entregue a reprodução e o impasse ao coordenador. Esta skill não faz merge.
