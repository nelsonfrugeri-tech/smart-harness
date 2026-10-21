// Entry point of `npm run seed:marketplace`. Runs after `npm run seed`, against the same
// database and the package bucket configured by S3_*.
import { loadConfig } from "../src/config.ts";
import { openDatabase } from "../src/db/database.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { createPackageStorage, createS3Client } from "../src/storage/packages.ts";
import { seedMarketplace } from "./marketplace.ts";

const config = loadConfig();
if (config.appEnv !== "local") {
  console.error(JSON.stringify({ level: 50, msg: "seed refused: APP_ENV must be local", app_env: config.appEnv }));
  process.exit(1);
}

const db = openDatabase(config.databasePath);
try {
  runMigrations(db);
  const storage = createPackageStorage(createS3Client(config.storage), config.storage.bucket);
  await storage.ensureBucket();
  const result = await seedMarketplace({ db, storage });
  console.log(JSON.stringify({ level: 30, msg: "marketplace seed applied", ...result }));
} finally {
  db.close();
}
