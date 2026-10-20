# agent-gateway

Porta única do coding agent para MCPs e modelos, em Node/TypeScript. Hoje expõe só `GET /healthz`.

```bash
npm ci
npm run check   # tsc, eslint e vitest
npm start       # escuta em 127.0.0.1:8081 (HOST e PORT mudam isso)
curl -fsS 127.0.0.1:8081/healthz   # {"status":"ok"}
```

Rota desconhecida responde 404 em JSON. O Node 24 executa o TypeScript direto, sem etapa de build.

No compose, a imagem roda com usuário não root e monta o volume `sqlite-data` em `/data`.

## Dependências

- `fastify`: servidor HTTP consolidado, com logs JSON (pino) e `inject()` para testar rotas sem abrir porta.
- `typescript` e `@types/node`: checagem de tipos (`tsc`, sem emitir arquivos).
- `eslint`, `@eslint/js` e `typescript-eslint`: lint com as regras recomendadas para TypeScript.
- `vitest`: runner de testes com suporte nativo a TypeScript.
