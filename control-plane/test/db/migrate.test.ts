import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../src/db/database.ts";
import { runMigrations } from "../../src/db/migrate.ts";

describe("runMigrations", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "migrations-"));
    db = openDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("applies pending files once, in version order", () => {
    writeFileSync(join(dir, "0002_add_b.sql"), "CREATE TABLE b (id INTEGER PRIMARY KEY);");
    writeFileSync(join(dir, "0001_add_a.sql"), "CREATE TABLE a (id INTEGER PRIMARY KEY);");

    expect(runMigrations(db, dir)).toEqual(["0001_add_a.sql", "0002_add_b.sql"]);
    expect(runMigrations(db, dir)).toEqual([]);

    const rows = db.prepare("SELECT version, file_name FROM schema_migrations ORDER BY version").all();
    expect(rows).toEqual([
      { version: "0001", file_name: "0001_add_a.sql" },
      { version: "0002", file_name: "0002_add_b.sql" },
    ]);
  });

  it("fails when an applied file changes", () => {
    const file = join(dir, "0001_add_a.sql");
    writeFileSync(file, "CREATE TABLE a (id INTEGER PRIMARY KEY);");
    runMigrations(db, dir);

    appendFileSync(file, "\nCREATE TABLE sneaky (id INTEGER);");

    expect(() => runMigrations(db, dir)).toThrow(/0001_add_a\.sql changed after being applied/);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'sneaky'").get()).toBeUndefined();
  });

  it("fails when an applied file is deleted", () => {
    const file = join(dir, "0001_add_a.sql");
    writeFileSync(file, "CREATE TABLE a (id INTEGER PRIMARY KEY);");
    runMigrations(db, dir);
    rmSync(file);

    expect(() => runMigrations(db, dir)).toThrow(/applied migration 0001_add_a\.sql is missing/);
  });

  it("rolls back a failing file and records nothing for it", () => {
    writeFileSync(join(dir, "0001_broken.sql"), "CREATE TABLE ok (id INTEGER); CREATE TABLE ok (id INTEGER);");

    expect(() => runMigrations(db, dir)).toThrow(/already exists/);
    expect(db.prepare("SELECT count(*) AS n FROM schema_migrations").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'ok'").get()).toBeUndefined();
  });

  it("rejects badly named files and duplicated versions", () => {
    writeFileSync(join(dir, "init.sql"), "SELECT 1;");
    expect(() => runMigrations(db, dir)).toThrow(/init\.sql must be named NNNN_name\.sql/);

    rmSync(join(dir, "init.sql"));
    writeFileSync(join(dir, "0001_a.sql"), "SELECT 1;");
    writeFileSync(join(dir, "0001_b.sql"), "SELECT 1;");
    expect(() => runMigrations(db, dir)).toThrow(/version 0001 is used by more than one file/);
  });

  it("applies the repository migrations to an empty database", () => {
    expect(runMigrations(db)).toEqual([
      "0001_initial.sql",
      "0002_marketplace.sql",
      "0003_gateway_tokens.sql",
      "0004_gateway_permissions.sql",
    ]);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual([
      "audit_events",
      "components",
      "gateway_permissions",
      "gateway_tokens",
      "memberships",
      "plugin_versions",
      "plugins",
      "project_baseline",
      "projects",
      "schema_migrations",
      "tenants",
      "users",
    ]);
  });
});
