# Contrato observado

Revisão inspecionada em 2026-10-22:
[`f097b94b0dd0dad367cdd7bb2f8312281a6ca90e`](https://github.com/totvs/md2poui/tree/f097b94b0dd0dad367cdd7bb2f8312281a6ca90e).
O checkout pode ter mudado: estas observações precisam ser conferidas no head da tarefa.

| Ponto | Comportamento do código inspecionado |
| --- | --- |
| `src/bin/md2poui.ts` | yargs 17 declara `srcPath/destDir`, porém lê `source/destination`; `home` ainda não é encaminhado |
| `src/index.ts` | `lstatSync` decide entre modo caminho e modo texto; erro de stat retorna false e leva ao modo texto |
| `adjustOptions` | `defaults` aplica os valores padrão, resolve exclusions relativas à origem e renderiza placeholders via Mustache |
| `src/options.ts` | `flatDirs`, `recursive`, `createHelpers`, `home`, `copyExternalFiles`: true; `exclusions` e `imports`: arrays vazios |
| Nomes padrão | `moduleName=docs`, `parentRoutePath={{moduleName}}`, `resourceFolderName=assets`, `resourcePathName=app/{{moduleName}}/{{resourceFolderName}}` |

Os comentários de resourceFolderName/resourcePathName estão trocados em relação aos
valores de `defaultOptions`; use o código e a saída observada para estabelecer o contrato.
O overload textual não oferece um terceiro argumento de opções em sua assinatura.
Não unifique os modos por uma alteração incidental de validação.

`package.json`: TypeScript 4.9, Mocha 10, CommonJS. `npm test` executa o pretest com gulp
limpando `test/result`, compila com `tsconfig.app.json` e roda `mocha ./test`.
`npm run build` também limpa `dist` e o postbuild executa `npm pack`; não é requisito
adicional quando `npm test` já verifica a mudança. `npm ci --ignore-scripts` só em
checkout isolado com node_modules próprio, se a instalação estiver autorizada.

Os 10 testes originais chamam a biblioteca. Não cobrem subprocesso CLI nem comprovam
tratamento dos erros acima. Adicione observações de comportamento, não asserts que
apenas repetem nomes de propriedades do parser.
