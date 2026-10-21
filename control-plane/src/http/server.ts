import { randomUUID } from "node:crypto";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import type { Config } from "../config.ts";
import type { Db } from "../db/database.ts";
import type { PackageStorage } from "../storage/packages.ts";
import { registerMetrics } from "./metrics.ts";
import { registerProblemHandlers } from "./problem.ts";
import { registerDevLoginRoute } from "./routes/auth.ts";
import { registerMarketplaceRoutes } from "./routes/marketplace.ts";
import { registerMeRoute } from "./routes/me.ts";
import { registerOpsRoutes } from "./routes/ops.ts";
import { registerProjectRoutes } from "./routes/projects.ts";

export const CORRELATION_HEADER = "x-correlation-id";
const VALID_CORRELATION_ID = /^[A-Za-z0-9._-]{1,128}$/;

export interface ServerOptions {
  db: Db;
  storage: PackageStorage;
  config: Pick<Config, "appEnv" | "jwtSecret" | "tokenTtlSeconds" | "logLevel" | "gatewayPublicUrl">;
  logger?: boolean;
}

// Registers every route without opening a port; tests use app.inject().
export function buildServer({ db, storage, config, logger = false }: ServerOptions): FastifyInstance {
  const app = Fastify({
    logger: logger ? { level: config.logLevel } : false,
    // Reuses the caller's correlation id when it is well formed, otherwise creates one.
    genReqId: (request) => {
      const incoming = request.headers[CORRELATION_HEADER];
      return typeof incoming === "string" && VALID_CORRELATION_ID.test(incoming)
        ? incoming
        : randomUUID();
    },
    logController: new LogController({ requestIdLogLabel: "correlation_id" }),
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header(CORRELATION_HEADER, request.id);
  });

  registerProblemHandlers(app);
  const metrics = registerMetrics(app);

  registerOpsRoutes(app, { db, storage, metrics });
  registerMeRoute(app, { db, jwtSecret: config.jwtSecret });
  registerProjectRoutes(app, { db, jwtSecret: config.jwtSecret, gatewayPublicUrl: config.gatewayPublicUrl });
  registerMarketplaceRoutes(app, { db, jwtSecret: config.jwtSecret, storage });
  if (config.appEnv === "local") {
    registerDevLoginRoute(app, {
      db,
      jwtSecret: config.jwtSecret,
      tokenTtlSeconds: config.tokenTtlSeconds,
    });
  }

  return app;
}
