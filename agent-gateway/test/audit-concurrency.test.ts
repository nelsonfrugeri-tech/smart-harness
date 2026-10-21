import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../../control-plane/src/db/migrate.ts";
import { openDatabase } from "../../control-plane/src/db/database.ts";

const WORKER = new URL("./audit-load-worker.ts", import.meta.url).pathname;
const WRITES_PER_PROCESS = 500;

function runWorker(writer: "api" | "gateway", path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER, writer, path, String(WRITES_PER_PROCESS)], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${writer} worker exited ${code}: ${stderr}`))));
  });
}

describe("API and gateway writing to the same SQLite file", () => {
  it("keeps 1000 writes from two processes and passes integrity_check", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gateway-concurrency-"));
    const path = join(dir, "control-plane.sqlite");
    const db = openDatabase(path);
    runMigrations(db);

    // Two OS processes write at the same time: real lock contention, not sequential calls.
    await Promise.all([runWorker("api", path), runWorker("gateway", path)]);

    const count = (where: string) =>
      (db.prepare(`SELECT count(*) AS n FROM audit_events WHERE ${where}`).get() as { n: number }).n;
    expect(count("actor_user_id = 'load-api'")).toBe(WRITES_PER_PROCESS);
    expect(count("actor_user_id = 'load-gateway'")).toBe(WRITES_PER_PROCESS);
    expect(count("1 = 1")).toBe(2 * WRITES_PER_PROCESS);
    expect(db.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);
});
