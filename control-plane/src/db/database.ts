import Database from "better-sqlite3";

export type Db = Database.Database;

// Opens the SQLite file (or ":memory:") with the settings every connection needs.
export function openDatabase(path: string): Db {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Waits for a concurrent writer (for example the seed) instead of failing with SQLITE_BUSY.
  db.pragma("busy_timeout = 5000");
  return db;
}

// Readiness probe: throws when the connection is closed or the file is unreadable.
export function pingDatabase(db: Db): void {
  db.prepare("SELECT 1").get();
}
