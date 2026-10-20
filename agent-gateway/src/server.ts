import Fastify, { type FastifyInstance } from "fastify";

// Monta as rotas sem abrir porta; os testes usam app.inject().
export function buildServer(options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.get("/healthz", async () => ({ status: "ok" }));

  return app;
}
