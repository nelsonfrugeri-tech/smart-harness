# Fluxo observado

Fonte: [`totvs/md2poui@f097b94b`](https://github.com/totvs/md2poui/tree/f097b94b0dd0dad367cdd7bb2f8312281a6ca90e),
inspecionada em 2026-10-22. Conferir no checkout atual.

`src/renderer/poRenderer.ts` mantém título e lista de assets por instância. O primeiro
H1 não vazio vira título e deixa de aparecer no corpo; headings seguintes retornam HTML.
`src/templates/componentView.ts` usa título escapado pelo Mustache e conteúdo com
`{{&content}}`, sem escape adicional. `Transform.textToIcon` roda antes de marked.

`escapeCode` substitui ampersand, aspas duplas, sinais menor/maior e chaves. `escapeCodespan`
substitui apenas chaves; marked também participa do processamento inline. Testar pela
entrada pública evita confundir responsabilidade de cada camada.

`link` considera interno um href que não contém `http` e contém `.md`; deriva routerLink
do último segmento do diretório. Os demais recebem href, target blank e rel noopener
noreferrer. Não assumir que esse critério reconhece todos os protocolos e fragmentos.

`image` reescreve assets locais quando copyExternalFiles está ativo, usando UUID v1 +
extensão e resourcePathName. O renderer acumula from/to; `Converter.copyFiles` copia de
cada diretório Markdown para o resourceFolderName de destino. `html` também procura src
com regex; isso não é um parser HTML completo. As imagens são envolvidas em span.

O import de `sanitize-html` é usado em `adjustTitleToFragment`, cujo uso no heading está
comentado. Portanto, importar a biblioteca não demonstra sanitização do HTML renderizado.
A conversão textual cria renderer sem passar por `adjustOptions`; não assumir que recebe
os defaults do modo de arquivos em todos os caminhos.

Os testes originais usam Markdown de um H1 e comparam artefatos a templates. Não demonstram
escapes, links ou cópia de assets. Para testes novos, capture entradas pequenas e saída
independente dos mesmos templates de produção.
