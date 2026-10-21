import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "./config.ts";
import { openDatabase, type Db } from "./db/database.ts";
import { runMigrations } from "./db/migrate.ts";
import { createCliHarnessClient } from "./harness/cli-client.ts";
import { buildServer } from "./http/server.ts";
import { createPackageStorage, createS3Client } from "./storage/packages.ts";

// Startup order: config, database, migrations, package bucket, HTTP. Any failure stops the process.
let db: Db | undefined;
try {
  const config = loadConfig();
  if (config.databasePath !== ":memory:") {
    mkdirSync(dirname(config.databasePath), { recursive: true });
  }
  db = openDatabase(config.databasePath);
  const applied = runMigrations(db);

  const storage = createPackageStorage(createS3Client(config.storage), config.storage.bucket);
  await storage.ensureBucket();

  // The harness binary comes from PATH (/usr/local/bin/harness in the image).
  const app = buildServer({ db, storage, harness: createCliHarnessClient(), config, logger: true });
  app.log.info({ applied_migrations: applied, app_env: config.appEnv }, "database migrated");
  app.log.info({ bucket: config.storage.bucket }, "package bucket ready");
  app.addHook("onClose", async () => db?.close());

  // Closes the server when the container stops, without waiting for SIGKILL.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => void app.close());
  }

  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  db?.close();
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ level: 60, time: Date.now(), msg: "startup failed", error: message }));
  process.exit(1);
}
