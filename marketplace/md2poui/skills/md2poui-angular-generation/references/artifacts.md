# Artefatos e opções observados

Fonte: [`totvs/md2poui@f097b94b`](https://github.com/totvs/md2poui/tree/f097b94b0dd0dad367cdd7bb2f8312281a6ca90e),
inspecionada em 2026-10-22. Conferir na revisão entregue.

- `Converter.execute`: cria home primeiro, obtém Markdown, cria Component e grava classe/
  view; depois gera module, routing e service se createHelpers estiver ativo. O baseline
  não oferece transação que desfaça todos os arquivos após falha; prevenção de saída
  parcial é requisito a implementar quando estiver na tarefa.
- `getMarkdownFiles`: aceita arquivo diretamente; diretório percorre recursivamente quando
  recursive=true e filtra extensão `.md`. Exclusions chegam resolvidas contra srcPath;
  a filtragem usa tanto caminho exato quanto prefixo de dirname. Não assumir sem testar
  que prefixos parecidos ou arquivos com outras extensões são tratados como esperado.
- `Component`: deriva path e name do diretório relativo; flatDirs usa o último segmento;
  caminho hierárquico normaliza separadores. Class name usa `Transform.pascalCase`.
  `adjustDirname` remove prefixo conforme regex existente; confira casos de nomes em vez
  de prometer remoção de qualquer numeração. Múltiplos Markdown no mesmo diretório podem
  compartilhar nomes: ausência de colisão não está comprovada pelos testes originais.
- `templates/module.ts` e `routing.ts`: Mustache condiciona home. Com home, as rotas dos
  componentes viram children; sem home, ficam diretas. Wildcard redireciona ao primeiro
  nome de componente. Origem vazia precisa de expectativa própria se entrar na tarefa.
- `loadMenuItems`: label é título ou className, link usa parentRoutePath se não vazio;
  flatDirs=false procura pai nos itens já acumulados. `templates/menuItem.ts` renderiza
  subItems via partial recursivo. Serviço expõe getMenuItems; home o usa para po-menu.
- `templates/component.ts`: selector, templateUrl e class name derivam da identidade;
  `componentView.ts` recebe título/conteúdo. Alterar identidade afeta vários arquivos.

Os testes existentes conferem classe/view, módulo e serviço para duas fixtures simples,
com home=false, recursive=false e flatDirs=true. Eles não estabelecem cobertura das outras
combinações, routing, erros ou execução Angular. `npm test` compila a ferramenta TypeScript,
não a aplicação Angular gerada.
