---
id: BL-001
title: Corrigir conversão pela CLI e controlar página inicial
status: ready
priority: high
labels: [typescript, cli, demo]
---

# BL-001 — Corrigir conversão pela CLI e controlar página inicial

Como usuário do md2poui, quero converter meu diretório Markdown pela CLI e escolher
se a página inicial será gerada, para integrar a documentação à minha aplicação PO-UI.

## Problema reproduzido

No commit `f097b94b0dd0dad367cdd7bb2f8312281a6ca90e`, `npm test` passa os 10 testes,
mas `node dist/bin/md2poui.js test/markdown /tmp/md2poui-before` termina com código 1
 e `TypeError: Cannot read properties of undefined (reading 'replace')`.

## Aceite

- A CLI recebe origem e destino posicionais e gera componentes `.ts` e `.html` no destino indicado, com saída 0.
- Sem a opção `home`, gera `docs-home.component.ts` e `docs-home.component.html`.
- `--home` mantém a geração; `--no-home` não gera esses arquivos nem referências a eles nos auxiliares.
- Argumentos obrigatórios ausentes, origem inexistente e destino que seja arquivo retornam saída diferente de 0, mensagem útil e nenhuma saída parcial.
- Testes executam a CLI em processo real, usando diretórios temporários próprios; os 10 testes existentes continuam passando.
- PR no fork contém reprodução antes/depois, testes executados e links desta história e da ADR.

## Contexto e limites

Fork: https://github.com/nelsonfrugeri-tech/md2poui

Branch inicial preservado: `demo-start`. Criar um branch novo para cada ensaio.
Decisão: [ADR-001](../adr/ADR-001-cli-home.md), a ser publicada no Notion e ligada aqui.
Sem novas dependências, aplicação web, atualização de stack ou alterações no upstream.
A revisão é independente; comentar apenas BLOCKER/MAJOR comprovados.
