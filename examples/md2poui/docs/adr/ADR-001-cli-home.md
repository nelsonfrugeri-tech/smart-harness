---
id: ADR-001
title: CLI funcional com controle da página inicial
status: accepted
date: 2026-10-21
tags: [typescript, cli, md2poui]
---

# ADR-001 — CLI funcional com controle da página inicial

## Contexto

O fork https://github.com/nelsonfrugeri-tech/md2poui parte do upstream TOTVS
`f097b94b0dd0dad367cdd7bb2f8312281a6ca90e`. Os 10 testes da biblioteca passam,
mas a CLI falha ao converter um diretório: declara `srcPath/destDir` e lê
`source/destination`. A biblioteca já oferece `home`, com padrão `true`;
a CLI não expõe essa opção.

## Decisão

Corrigir o encaminhamento dos dois argumentos e oferecer `--home` e `--no-home`.
Manter `home=true` quando omitido e preservar a API da biblioteca. Validar os
argumentos antes de iniciar a conversão; argumentos obrigatórios ausentes,
origem inexistente e destino que seja arquivo devem terminar com código diferente
de zero e mensagem útil, sem stack trace nem arquivos parcialmente gerados.

Os testes devem executar o processo da CLI, verificar código de saída e arquivos
em diretórios temporários próprios. Preservar os testes existentes. A mudança
não inclui atualização de dependências, refatoração geral ou aplicação web.

## Colaboração

A história BL-001 contém os critérios de aceite. O agente usa Graphify para
localizar o fluxo e deja-vu para recuperar decisões reais, citando as fontes que
conseguiram ler. O developer abre o PR somente no fork. Outro agente revisa e
registra apenas BLOCKER/MAJOR; nenhuma falha ou aprovação é roteirizada.

## Consequências

A demonstração apresenta uma correção observável e uma opção já suportada pela
biblioteca. Integrações indisponíveis devem ser reportadas como tal: ler esta
cópia local não prova leitura do Notion ou Trello.

História local: [BL-001](../backlog/BL-001-cli-home.md).
Links externos da história e ADR: consultar o README deste contexto após publicação.
