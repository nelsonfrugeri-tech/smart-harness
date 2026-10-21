import type { FastifyInstance } from "fastify";
import type { Registry } from "@prometheus-io/client";
import { pingDatabase, type Db } from "../../db/database.ts";
import { sendProblem } from "../problem.ts";

export interface OpsDeps {
  db: Db;
  metrics: Registry;
}

// healthz: the process answers. readyz: the database answers too. metrics: Prometheus text format.
export function registerOpsRoutes(app: FastifyInstance, deps: OpsDeps): void {
  app.get("/healthz", async () => ({ status: "ok" }));

  app.get("/readyz", async (request, reply) => {
    try {
      pingDatabase(deps.db);
    } catch (error) {
      request.log.warn({ err: error }, "database is not ready");
      return sendProblem(request, reply, 503, "not_ready", "database is not reachable");
    }
    return { status: "ready" };
  });

  app.get("/metrics", async (_request, reply) =>
    reply.type(deps.metrics.contentType).send(await deps.metrics.metrics()),
  );
}
