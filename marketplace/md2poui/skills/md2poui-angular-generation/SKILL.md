---
name: md2poui-angular-generation
description: Change or test md2poui generated Angular components, routes, menus and home artifacts, including flatDirs, recursion and exclusions.
---

# Geração dos artefatos Angular

Use ao alterar `Converter`, `Component` ou os templates. Leia
[as relações entre artefatos](references/artifacts.md) e revalide o head local.

1. Trace arquivos selecionados → identidade do Component → classe/view → módulo,
   rotas e serviço/menu. Consulte Graphify disponível para localizar relações, depois
   leia o código correspondente. Não trate uma relação inferida como execução observada.
2. Escolha fixtures que diferenciem a opção alterada: diretório raiz e subdiretório,
   arquivo excluído e diretório excluído, flatDirs true/false, recursive true/false.
   Confira a lista concreta de arquivos gerados e as referências entre eles.
3. Para home, verifique tanto arquivos `.ts/.html` quanto import/declaration/rotas.
   Para createHelpers, confira module, routing e service juntos. Home e helpers são
   flags independentes no baseline; não invente dependência nem mude a combinação sem
   requisito. Um arquivo existir não prova que o conjunto pode ser consumido.
4. Compare caminho físico, import relativo, classe e rota dos mesmos componentes.
   Nomes derivam do diretório, não do nome Markdown. Use fixture com nomes que possam
   colidir se a tarefa envolver flattening ou múltiplos arquivos; reproduza o efeito
   antes de propor regra de desambiguação.
5. Para menu, confira título e fallback, parentRoutePath e subItems hierárquicos.
   Se mudar templates de strings TypeScript, use títulos com aspas/chaves no caso
   relevante e valide sintaxe dos artefatos; comparar ao mesmo template mascara erro.
6. Execute a biblioteca ou CLI real e verifique artefatos em diretório temporário próprio.
   Testes que só renderizam Mustache isolado não cobrem seleção, nomes e gravação.
   Preserve a API pública e rode `npm test`. Não instale uma aplicação Angular inteira
   para provar apenas seleção de arquivos; se execução Angular for requisito, declare
   e realize essa verificação separadamente.

Relate o alcance da prova: geração correta nos casos exercitados não significa que uma
aplicação Angular foi compilada ou renderizada. Não inclua dist, grafos ou outputs no commit.
