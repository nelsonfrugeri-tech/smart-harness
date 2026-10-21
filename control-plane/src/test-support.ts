// Shared test setup: an in-memory database with the real migrations and the local seed.
import type { FastifyInstance } from "fastify";
import { seedLocalData } from "../seed/local-data.ts";
import type { AppEnv } from "./config.ts";
import { openDatabase, type Db } from "./db/database.ts";
import { runMigrations } from "./db/migrate.ts";
import { buildServer } from "./http/server.ts";

export const TEST_SECRET = new TextEncoder().encode("test-secret-with-at-least-32-characters");

export function seededDatabase(): Db {
  const db = openDatabase(":memory:");
  runMigrations(db);
  seedLocalData(db);
  return db;
}

export function testServer(db: Db, appEnv: AppEnv = "local"): FastifyInstance {
  return buildServer({
    db,
    config: { appEnv, jwtSecret: TEST_SECRET, tokenTtlSeconds: 3600, logLevel: "silent" },
  });
}

export async function login(app: FastifyInstance, email: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/v1/auth/dev-login", payload: { email } });
  if (response.statusCode !== 200) {
    throw new Error(`dev-login for ${email} answered ${response.statusCode}: ${response.body}`);
  }
  return response.json<{ access_token: string }>().access_token;
}

export function tenantId(db: Db, slug: string): string {
  return (db.prepare("SELECT id FROM tenants WHERE slug = ?").get(slug) as { id: string }).id;
}

export function userId(db: Db, email: string): string {
  return (db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string }).id;
}
