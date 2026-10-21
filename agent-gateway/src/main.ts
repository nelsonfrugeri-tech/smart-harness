import { echoBackend } from "./backends/echo.ts";
import { loadConfig } from "./config.ts";
import { createAuditSink } from "./db/audit.ts";
import { openAuditDatabase, openReadDatabase, type Db } from "./db/database.ts";
import { createRegistry, type McpBackend } from "./mcp/backend.ts";
import { loadModelUpstream } from "./model-proxy/config.ts";
import { createModelUsageSink } from "./model-proxy/usage-sink.ts";
import { buildServer } from "./server.ts";

// Startup order: config, databases, HTTP. The control plane must have created and migrated the
// file first (compose starts the gateway after the API is healthy). Any failure stops the process.
const databases: Db[] = [];
try {
  const config = loadConfig();
  const readDb = openReadDatabase(config.databasePath);
  databases.push(readDb);
  const auditDb = openAuditDatabase(config.databasePath);
  databases.push(auditDb);

  const modelUpstream = loadModelUpstream();

  // Real backends (github, trello, notion, project) arrive with #14.
  const backends: McpBackend[] = config.appEnv === "local" ? [echoBackend] : [];
  const app = buildServer({
    readDb,
    auditDb,
    audit: createAuditSink(auditDb),
    backends: createRegistry(backends),
    config,
    modelProxy: { usage: createModelUsageSink(auditDb), upstream: modelUpstream },
    logger: true,
  });
  app.log.info({ app_env: config.appEnv, model_proxy: modelUpstream === undefined ? "disabled" : new URL(modelUpstream.url).host, servers: backends.map((backend) => backend.server) }, "gateway ready");
  app.addHook("onClose", async () => databases.forEach((db) => db.close()));

  // Closes the server when the container stops, without waiting for SIGKILL.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => void app.close());
  }

  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  databases.forEach((db) => db.close());
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ level: 60, time: Date.now(), msg: "startup failed", error: message }));
  process.exit(1);
}
