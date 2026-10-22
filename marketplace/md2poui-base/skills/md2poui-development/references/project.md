# Convenções observadas no md2poui

Fonte: `totvs/md2poui`, revisão `f097b94b0dd0dad367cdd7bb2f8312281a6ca90e`,
inspecionada em 2026-10-21. Revalidar no checkout antes de editar.

- `src/bin/md2poui.ts`: parser yargs 17 e encaminhamento para a biblioteca.
- `src/index.ts`: entrada da biblioteca e ajuste de opções.
- `src/options.ts`: contrato `Options`, incluindo `home`.
- `src/converter.ts`: geração dos componentes e auxiliares.
- TypeScript 4.9, CommonJS, aspas simples e ponto e vírgula nos arquivos inspecionados.
- `test/*.spec.js`: testes Mocha 10 em JavaScript, com fixtures Markdown. A configuração
  tem `strict=true` e `strictNullChecks=false`; não mudar a configuração na tarefa.
- `npm ci --ignore-scripts`: instalação pelo lockfile em checkout isolado com dependências
  próprias. Precisa de rede. Nunca usar sobre `node_modules` compartilhado por symlink.
- `npm test`: `pretest` remove `test/result` e compila `src` para `dist`; depois Mocha roda
  `./test`. Gera arquivos locais. O baseline inspecionado tem 10 testes da biblioteca.
- `npm run build` também limpa `dist`, copia arquivos e executa `npm pack` no postbuild.
  Não é necessário para corrigir a CLI; `npm test` já compila o código.
- Node 24.19.0 foi o ambiente do ensaio inicial. Esse ensaio não substitui executar os
  testes na revisão que será entregue.

A reprodução anterior usou `node dist/bin/md2poui.js test/markdown <destino-temporário>`.
O defeito observado foi a divergência entre posicionais `srcPath/destDir` e as leituras
`source/destination`. Verificar novamente antes de alterar. A biblioteca já suporta
`home=true`; a CLI ainda não o expunha nessa revisão.

Para BL-001, preservar dependências e API. Testes novos devem executar o binário compilado
com `process.execPath`, conferir código de saída e conteúdo/ausência dos arquivos e limpar
somente seus próprios diretórios temporários. Não chamar apenas a função de conversão:
isso deixa o parser e o encaminhamento dos argumentos sem cobertura.

Processo adaptado da skill `developer`, versão 1.0.0, inspecionada em 2026-10-21,
SHA-256 `d6041ea407f8679ee9e39b0661610b6644756922fdf036c195341b3406a6699f`.
Retidos: checkout isolado, reprodução antes da correção, checks reais e handoff para
review independente. Sem dependência do plano ou de configuração pessoal do autor.
