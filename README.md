# Smart Harness

Plataforma para descoberta, criação e distribuição de Agent Plugins por squads, com onboarding e contribuição governada.

## Visão

O desenvolvedor encontra os agentes, skills e MCPs disponíveis para seus projetos e prepara seu coding agent com o pacote base do time. Também pode criar capacidades próprias e propor sua distribuição para outras pessoas.

A experiência contempla dois perfis: desenvolvedor e administrador.

## Escopo em definição

- Workspace com projetos e agentes acessíveis ao desenvolvedor.
- Pacote base por projeto, com orientação do agente, skills e configurações de MCPs.
- Catálogo com descrições, exemplos de uso e requisitos de configuração.
- Espaço pessoal para criar agentes e skills.
- Processo de teste, revisão, aprovação e publicação de contribuições.
- Administração de squads, acesso e pacotes.

Memory as a Service fica para uma fase posterior.

## Estrutura

| Pasta | Conteúdo |
| --- | --- |
| `control-plane/` | API em Node/TypeScript |
| `agent-gateway/` | Gateway para MCPs e modelos, em Node/TypeScript |
| `cli/` | CLI `harness` em Go (único `go.mod`) |
| `catalog/` | Conteúdo do catálogo |
| `examples/` | Exemplos de pacotes e de uso |
| `docs/` | ADRs, contratos e diagramas (o SVG é exportado pela interface do Excalidraw a partir de `docs/arch/propose.excalidraw`) |

## Comandos

Requer Node 24, Go 1.27, Docker e make.

```bash
make check                       # checagens de todos os componentes
cp .env.example .env && make up  # sobe api (8080) e gateway (8081) em 127.0.0.1
make down                        # para os serviços e preserva o volume sqlite-data
```

## Planejamento e entrega

Usamos [GitHub Issues](https://github.com/nelsonfrugeri-tech/smart-harness/issues) como fonte de definição das features e de acompanhamento das entregas.

1. Criar uma Issue pelo template de feature.
2. Refinar problema, escopo, decisões pendentes e critérios de aceite na Issue.
3. Implementar o escopo definido e vincular o pull request à Issue.
4. Registrar a validação no pull request e fechar a Issue após a entrega atender aos critérios.

As propostas listadas acima ainda precisam ser refinadas em Issues. Stack, integrações e automação de publicação serão definidas durante esse refinamento.
