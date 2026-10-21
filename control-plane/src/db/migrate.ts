import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./database.ts";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));

const FILE_NAME = /^(\d{4})_([a-z0-9_]+)\.sql$/;

interface MigrationFile {
  version: string;
  fileName: string;
  sql: string;
  checksum: string;
}

interface AppliedMigration {
  version: string;
  file_name: string;
  checksum: string;
}

// Applies pending migrations in version order, each one in its own transaction.
// Fails when an applied file changed or disappeared, or a file name breaks the NNNN_name.sql rule.
// Returns the file names applied by this call.
export function runMigrations(db: Db, dir: string = MIGRATIONS_DIR): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ) STRICT
  `);

  const files = readMigrationFiles(dir);
  const applied = db
    .prepare("SELECT version, file_name, checksum FROM schema_migrations ORDER BY version")
    .all() as AppliedMigration[];
  verifyApplied(applied, files, dir);

  const appliedVersions = new Set(applied.map((row) => row.version));
  const pending = files.filter((file) => !appliedVersions.has(file.version));
  const record = db.prepare(
    "INSERT INTO schema_migrations (version, file_name, checksum) VALUES (?, ?, ?)",
  );

  for (const file of pending) {
    db.transaction(() => {
      db.exec(file.sql);
      record.run(file.version, file.fileName, file.checksum);
    }).immediate();
  }

  return pending.map((file) => file.fileName);
}

function verifyApplied(applied: AppliedMigration[], files: MigrationFile[], dir: string): void {
  const filesByVersion = new Map(files.map((file) => [file.version, file]));

  for (const row of applied) {
    const file = filesByVersion.get(row.version);
    if (!file) {
      throw new Error(`applied migration ${row.file_name} is missing from ${dir}`);
    }
    if (file.checksum !== row.checksum) {
      throw new Error(
        `migration ${file.fileName} changed after being applied ` +
          `(recorded sha256 ${row.checksum}, file sha256 ${file.checksum}); add a new migration instead`,
      );
    }
  }
}

function readMigrationFiles(dir: string): MigrationFile[] {
  const files: MigrationFile[] = [];
  const seenVersions = new Set<string>();

  for (const fileName of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
    const match = FILE_NAME.exec(fileName);
    if (!match) {
      throw new Error(`migration file ${fileName} must be named NNNN_name.sql`);
    }
    const version = match[1];
    if (seenVersions.has(version)) {
      throw new Error(`migration version ${version} is used by more than one file`);
    }
    seenVersions.add(version);

    const sql = readFileSync(join(dir, fileName), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    files.push({ version, fileName, sql, checksum });
  }

  return files;
}
