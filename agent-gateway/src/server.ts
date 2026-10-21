import { randomUUID } from "node:crypto";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import type { Config } from "./config.ts";
import type { AuditSink } from "./db/audit.ts";
import type { Db } from "./db/database.ts";
import { registerMetrics } from "./http/metrics.ts";
import { registerMcpRoutes } from "./http/routes/mcp.ts";
import { registerOpsRoutes } from "./http/routes/ops.ts";
import type { BackendRegistry } from "./mcp/backend.ts";

export const CORRELATION_HEADER = "x-correlation-id";
const VALID_CORRELATION_ID = /^[A-Za-z0-9._-]{1,128}$/;

export interface ServerOptions {
  readDb: Db;
  auditDb: Db;
  audit: AuditSink;
  backends: BackendRegistry;
  config: Pick<Config, "logLevel" | "allowedOrigins">;
  logger?: boolean;
  // Where log lines go when logger is true; stdout by default. Tests pass a collector.
  logStream?: { write(line: string): void };
}

// Registers the routes without opening a port; tests use app.inject().
export function buildServer({ readDb, auditDb, audit, backends, config, logger = false, logStream }: ServerOptions): FastifyInstance {
  const app = Fastify({
    logger: logger ? { level: config.logLevel, ...(logStream === undefined ? {} : { stream: logStream }) } : false,
    // Reuses the caller's correlation id when it is well formed, otherwise creates one.
    genReqId: (request) => {
      const incoming = request.headers[CORRELATION_HEADER];
      return typeof incoming === "string" && VALID_CORRELATION_ID.test(incoming) ? incoming : randomUUID();
    },
    logController: new LogController({ requestIdLogLabel: "correlation_id" }),
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header(CORRELATION_HEADER, request.id);
  });

  const { registry, toolCalls } = registerMetrics(app);
  registerOpsRoutes(app, { readDb, auditDb, metrics: registry });
  registerMcpRoutes(app, { readDb, audit, backends, allowedOrigins: config.allowedOrigins, toolCalls });

  return app;
}
