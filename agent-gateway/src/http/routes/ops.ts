import type { FastifyInstance } from "fastify";
import type { Registry } from "@prometheus-io/client";
import { pingDatabase, type Db } from "../../db/database.ts";

export interface OpsDeps {
  readDb: Db;
  auditDb: Db;
  metrics: Registry;
}

// healthz: the process answers. readyz: both database connections answer too. metrics: Prometheus text format.
export function registerOpsRoutes(app: FastifyInstance, deps: OpsDeps): void {
  app.get("/healthz", async () => ({ status: "ok" }));

  app.get("/readyz", async (request, reply) => {
    try {
      pingDatabase(deps.readDb);
      pingDatabase(deps.auditDb);
    } catch (error) {
      request.log.warn({ err: error }, "database is not ready");
      return reply.code(503).send({ error: "not_ready", message: "database is not reachable" });
    }
    return { status: "ready" };
  });

  app.get("/metrics", async (_request, reply) =>
    reply.type(deps.metrics.contentType).send(await deps.metrics.metrics()),
  );
}
