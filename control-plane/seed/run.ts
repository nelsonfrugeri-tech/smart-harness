// Entry point of `npm run seed`. Applies pending migrations, then upserts the local sample data.
import { loadConfig } from "../src/config.ts";
import { openDatabase } from "../src/db/database.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { personalResourcesFromEnv, seedPersonalData } from "./personal-data.ts";

const config = loadConfig();
if (config.appEnv !== "local") {
  console.error(JSON.stringify({ level: 50, msg: "seed refused: APP_ENV must be local", app_env: config.appEnv }));
  process.exit(1);
}

const db = openDatabase(config.databasePath);
try {
  runMigrations(db);
  const counts = seedPersonalData(db, personalResourcesFromEnv());
  console.log(JSON.stringify({ level: 30, msg: "personal seed applied", ...counts }));
} finally {
  db.close();
}
