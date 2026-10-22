# Fonte e contrato

Adaptação do processo `review`, metadata versão 2.0.0, last_verified 2026-09-06.
Fonte local inspecionada em 2026-10-22, SHA-256
`1e4fd86eaa995bdfe35ee4b19e034cb786105e168b73f9f561b1d977d598e60f`.
Retém independência, Standards/Spec, evidência e revalidação do commit. Não inclui
credenciais, configuração pessoal nem reprodução integral do processo original.
O filtro somente BLOCKER/MAJOR segue a orientação explícita do usuário para este fluxo.

- **BLOCKER:** vulnerabilidade observada, risco de perda de dados, defeito crítico ou
  quebra de compatibilidade sem migração necessária.
- **MAJOR:** defeito material demonstrado de comportamento, confiabilidade, tratamento
  de erro ou cobertura necessária para a entrega.

Severidade depende do impacto no escopo real. Uma observação sem localização, evidência,
efeito e forma de verificar a correção não pode determinar a disposição.

Cada achado inclui: severidade; eixo primário Standards/Spec; eixo relacionado se houver;
arquivo/linha; comando/entrada e saída observada; efeito; correção mínima; verificação.
Deduplicar o mesmo defeito entre eixos sem perder as evidências.

Resultado mínimo:

- escopo, base/head e independência da sessão;
- fontes efetivamente lidas e checks efetivamente executados;
- Standards: passou, achados ou não avaliado;
- Spec: passou, achados ou não avaliado;
- BLOCKER/MAJOR pendentes e limitações;
- disposição: correção necessária, revisão incompleta ou pronto para aceite integrado.

Sem diff ou Spec material, revisão incompleta. Sem execução de um check, declarar essa
limitação; não apresentar zero achados como aprovação de comportamento não examinado.
O coordenador decide merge após o aceite e dentro da autorização do usuário.
