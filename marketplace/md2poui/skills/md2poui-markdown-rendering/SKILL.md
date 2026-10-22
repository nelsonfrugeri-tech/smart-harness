---
name: md2poui-markdown-rendering
description: Change or test md2poui Markdown rendering, titles, escaping, links and asset rewriting using fixtures and observed generated HTML.
---

# Renderização Markdown para PO-UI

Use em alterações do renderer, transformação de conteúdo, títulos, links e assets.
Leia [o fluxo e os limites observados](references/rendering.md) antes de escolher o teste.

- Navegue `Converter.convert`/`renderComponentView` → `Transform.textToIcon` →
  `marked`/`PoRenderer` → template `componentView`. Com Graphify disponível, consulte
  relações e confirme o código no head. Não execute extração remota só para ler o grafo.
- Diferencie conversão textual e geração em diretório: as opções e a cópia de arquivos
  passam por caminhos diferentes. Escolha a entrada pública que exercita o requisito.
- Use fixtures pequenas com primeiro H1, H1 posterior, H2 e ausência de H1. Confira
  separadamente o título da página, conteúdo restante e, se gerar arquivos, label do menu.
- Para escapes, inclua bloco e inline code com `<`, `>`, `&`, aspas e chaves Angular.
  Espere a saída pública definida pela tarefa; não copie o algoritmo de escape no teste.
  Não confunda escaping de código com sanitização geral do HTML.
- Para links, separe URL externa, `.md` relativo, fragmentos e nome de diretório.
  Confira `routerLink` e atributos dos links externos conforme o caso alterado.
- Para imagens/assets, use arquivo real em fixture temporária e opção de cópia on/off.
  Confira bytes copiados e que o src gerado aponta ao arquivo produzido. Os nomes usam
  UUID: não fixe um UUID literal nem ignore a correspondência entre HTML e disco.
- Ausência de asset, múltiplos src e conteúdo HTML cru precisam de expectativa explícita
  quando entrarem no escopo. Não adicione mudanças de segurança ou compatibilidade sem
  demonstrar o comportamento e entender o requisito; não diga que já há sanitização.
- Rode `npm test` no checkout isolado e revise os artefatos que os testes realmente
  exercitam. Os testes originais de template não substituem fixtures dos novos casos.

Fontes de tarefa e histórico vêm dos conectores/skills selecionados pelo usuário quando
disponíveis. Se uma fonte faltar, identifique a lacuna sem inventar uma leitura.
