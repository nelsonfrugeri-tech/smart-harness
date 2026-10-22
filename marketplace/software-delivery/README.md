# Agentes reutilizáveis de desenvolvimento e revisão

`software-delivery@1.0.0` contém `developer` e `reviewer`, com as skills
`development-workflow` e `code-review` incluídas. As skills de domínio são selecionadas
separadamente conforme a tarefa; por exemplo, as três skills do pacote `md2poui`.

Os agentes usam as ferramentas dos conectores selecionados na instalação pessoal.
Não declaram MCPs próprios nem exigem projeto cadastrado, repo de demonstração,
Trello ou Notion fixos. A ausência de um conector ou recurso é reportada como limitação.
A presença no catálogo não comprova autenticação nem leitura de contexto.

A instalação carrega os pacotes aprovados e os conectores escolhidos. Em sessões separadas:

```sh
claude --agent software-delivery:developer
claude --agent software-delivery:reviewer
```

O developer tem leitura, edição, shell e Skill; o reviewer não tem Edit/Write, mas usa
shell para checks e publicação autorizada. **Shell não é sandbox**: as permissões reais
continuam no host. O reviewer não altera produto nem faz merge. A revisão precisa ser
independente do autor e cobrir o commit atual.

O builder copia `marketplace/code-review/skills/code-review` para o pacote gerado, evitando
uma dependência externa silenciosa de preload. Build, parser, geração e empacotamento são
verificados com `node --test marketplace/test/personal-skills.test.mjs`. Isso não demonstra
que um modelo executou a feature ou que os conectores estão autenticados; são etapas do QA.
