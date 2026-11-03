# Documentação pública

Site: https://nelsonfrugeri-tech.github.io/smart-harness/

A documentação técnica e o roteiro de demonstração ficam em `docs/site/`.
O site é estático, sem dependências de runtime, chamadas à API ou credenciais.
O código da plataforma permanece privado; os arquivos desta pasta são publicados
no GitHub Pages. Não inclua tokens, conteúdo privado de sessões ou dados de clientes.

## Editar

- `content.js`: páginas, seções e exemplos. Use IDs estáveis para preservar links.
- `app.js`: navegação, busca, cópia e índice da página.
- `styles.css`: identidade visual, responsividade e estados de interação.
- `index.html`: estrutura acessível e assets relativos ao caminho do site.

Confira exemplos de comandos na implementação antes de documentá-los. Distinga
comportamento entregue, limitações e exercícios de reprodução. A demo usa uma
branch de integração própria para preservar `demo-start` e a master do fork.

## Validar e visualizar

Na raiz:

```sh
node docs/check-site.mjs
python3 -m http.server 18473 --bind 127.0.0.1 --directory docs/site
```

Abra `http://127.0.0.1:18473/`. O checker verifica páginas, links internos,
anchors declaradas, assets e sintaxe JavaScript. Ele não comprova renderização,
acessibilidade completa, acesso a links externos ou saúde dos MCPs.

Confira também navegação, busca, Escape, cópia de comandos, links profundos e
layout em 390, 768 e 1440 px. O checklist da demo é uma ajuda de apresentação;
suas marcações não executam checks nem persistem como evidência.

## Publicar

O workflow `.github/workflows/docs.yml` valida e publica somente `docs/site/`
quando seus arquivos mudam na master. Também aceita execução manual via Actions.
O ambiente de deploy é `github-pages`; as Actions são fixadas por commit.
Não é preciso compilar ou reiniciar a aplicação para publicar documentação.
