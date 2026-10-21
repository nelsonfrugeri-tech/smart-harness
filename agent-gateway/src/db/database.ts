import Database from "better-sqlite3";

export type Db = Database.Database;

// The control plane creates, migrates and owns the file. The gateway opens it twice:
// - a read-only connection for tokens, memberships, projects and permissions;
// - a write connection used only to append audit events.
// Both fail when the file does not exist, so the gateway never creates an empty database.

export function openReadDatabase(path: string): Db {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  db.pragma("busy_timeout = 5000");
  return db;
}

export function openAuditDatabase(path: string): Db {
  const db = new Database(path, { fileMustExist: true });
  db.pragma("journal_mode = WAL");
  // Waits for the API (the other writer) instead of failing with SQLITE_BUSY.
  db.pragma("busy_timeout = 5000");
  return db;
}

// Readiness probe: throws when the connection is closed or the file is unreadable.
export function pingDatabase(db: Db): void {
  db.prepare("SELECT 1").get();
}
