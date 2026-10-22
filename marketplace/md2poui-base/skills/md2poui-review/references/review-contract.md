# Contrato de review adaptado

Fonte: skill pessoal `review`, metadata `version: 2.0.0`, `last_verified: 2026-09-06`,
inspecionada em 2026-10-21, SHA-256
`1e4fd86eaa995bdfe35ee4b19e034cb786105e168b73f9f561b1d977d598e60f`. A adaptação retém independência, eixos Standards/Spec,
evidência reproduzível e revisão do commit exato. Não contém configuração pessoal,
credenciais, notas privadas nem cópia integral do processo original.

- **BLOCKER:** vulnerabilidade observada, risco de perda de dados, defeito crítico ou
  quebra de compatibilidade sem migração necessária.
- **MAJOR:** defeito material demonstrado de comportamento, confiabilidade, tratamento de
  erros ou cobertura necessária para esta entrega.
- Severidade depende do efeito nesta tarefa. Preferências, limpeza e riscos hipotéticos
  sem demonstração não viram comentários. Não publicar MINOR/NIT nesta demo.

Para cada achado: severidade; eixo Standards ou Spec; arquivo/linha no head examinado;
entrada/comando e saída observada; efeito; correção mínima; verificação que elimina o defeito.
Uma discordância fica explícita até ser resolvida por evidência.

O resultado contém:

- fork, PR, base e head SHA;
- independência da sessão e fontes de contexto realmente lidas;
- Standards: passou, achados ou não avaliado;
- Spec: passou, achados ou não avaliado;
- achados BLOCKER/MAJOR deduplicados;
- comandos executados, resultados e limitações;
- disposição: correção necessária, revisão incompleta ou pronto para aceite integrado.

Qualquer BLOCKER/MAJOR pendente impede merge neste fluxo. Sem diff ou Spec material,
a revisão é incompleta. Zero achados com checks indisponíveis não prova que os checks
passaram. Somente o coordenador confirma o aceite e executa merge no fork autorizado.
