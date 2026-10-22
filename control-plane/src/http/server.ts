import { randomUUID } from "node:crypto";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import type { Config } from "../config.ts";
import type { Db } from "../db/database.ts";
import type { HarnessClient } from "../domain/publish.ts";
import type { PackageStorage } from "../storage/packages.ts";
import { registerGatewayTokenGuard } from "./auth.ts";
import { registerMetrics } from "./metrics.ts";
import { registerProblemHandlers } from "./problem.ts";
import { registerDevLoginRoute } from "./routes/auth.ts";
import { registerContributionRoutes } from "./routes/contributions.ts";
import { registerDraftRoutes } from "./routes/drafts.ts";
import { registerGatewayTokenRoutes } from "./routes/gateway-tokens.ts";
import { registerMarketplaceRoutes } from "./routes/marketplace.ts";
import { DEFAULT_INSTALLER_VERSION, DEFAULT_PUBLIC_API_URL, type InstallerConfig } from "../domain/installer.ts";
import { registerInstallerRoutes } from "./routes/installer.ts";
import { registerMeRoute } from "./routes/me.ts";
import { registerOpsRoutes } from "./routes/ops.ts";
import { registerProjectRoutes } from "./routes/projects.ts";

export const CORRELATION_HEADER = "x-correlation-id";
const VALID_CORRELATION_ID = /^[A-Za-z0-9._-]{1,128}$/;

export interface ServerOptions {
  db: Db;
  storage: PackageStorage;
  // Runs `harness validate`, `generate` and `pack` for draft validation.
  harness: HarnessClient;
  config: Pick<
    Config,
    "appEnv" | "jwtSecret" | "tokenTtlSeconds" | "logLevel" | "gatewayPublicUrl" | "gatewayTokenTtlDays"
  > & Partial<InstallerConfig>;
  logger?: boolean;
  // Where log lines go when logger is true; stdout by default. Tests pass a collector.
  logStream?: { write(line: string): void };
}

// Registers every route without opening a port; tests use app.inject().
export function buildServer({ db, storage, harness, config, logger = false, logStream }: ServerOptions): FastifyInstance {
  const app = Fastify({
    logger: logger ? { level: config.logLevel, ...(logStream === undefined ? {} : { stream: logStream }) } : false,
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
  registerGatewayTokenGuard(app);

  registerOpsRoutes(app, { db, storage, metrics });
  registerInstallerRoutes(app, { publicApiUrl: config.publicApiUrl ?? DEFAULT_PUBLIC_API_URL,
    installerVersion: config.installerVersion ?? DEFAULT_INSTALLER_VERSION, installerAssetsDir: config.installerAssetsDir });
  registerMeRoute(app, { db, jwtSecret: config.jwtSecret, gatewayPublicUrl: config.gatewayPublicUrl });
  registerGatewayTokenRoutes(app, {
    db,
    jwtSecret: config.jwtSecret,
    gatewayTokenTtlDays: config.gatewayTokenTtlDays,
  });
  registerProjectRoutes(app, { db, jwtSecret: config.jwtSecret, gatewayPublicUrl: config.gatewayPublicUrl });
  registerMarketplaceRoutes(app, { db, jwtSecret: config.jwtSecret, storage });
  registerDraftRoutes(app, { db, jwtSecret: config.jwtSecret, storage, harness });
  registerContributionRoutes(app, { db, jwtSecret: config.jwtSecret });
  if (config.appEnv === "local") {
    registerDevLoginRoute(app, {
      db,
      jwtSecret: config.jwtSecret,
      tokenTtlSeconds: config.tokenTtlSeconds,
    });
  }

  return app;
}
