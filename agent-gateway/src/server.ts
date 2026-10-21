import Fastify, { type FastifyInstance } from "fastify";

// Registers the routes without opening a port; tests use app.inject().
export function buildServer(options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.get("/healthz", async () => ({ status: "ok" }));

  return app;
}
