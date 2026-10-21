import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedLocalData } from "../../../seed/local-data.ts";
import { openDatabase, type Db } from "../../../src/db/database.ts";
import { runMigrations } from "../../../src/db/migrate.ts";
import {
  login,
  marketplaceFixture,
  registeredRoutes,
  TEST_GATEWAY_TOKEN_TTL_DAYS,
  testServer,
  userId,
} from "../../test-support.ts";

const DEV = "dev@smart-harness.local"; // DEV in investimentos and conta
const DEV_CARTOES = "dev.cartoes@smart-harness.local";
const TOKENS = "/v1/me/gateway-tokens";
const SETUP_PLAN = "/v1/projects/investimentos-api/setup-plan";
const ARCHIVE = "/v1/plugins/investimentos-base/versions/1.1.0/archive";
const DAY_MS = 24 * 60 * 60 * 1000;

// The product reads a gateway token may call, as registered in Fastify.
const GATEWAY_TOKEN_READS = [
  "/v1/me",
  "/v1/workspace",
  "/v1/marketplace",
  "/v1/plugins/:name",
  "/v1/plugins/:name/versions",
  "/v1/plugins/:name/versions/:version/archive",
  "/v1/projects/:slug/setup-plan",
];

// Accepts the token too (`harness draft pull`), but the zero id is no draft: 404, not 401.
const GATEWAY_TOKEN_DRAFT_ARCHIVE = "/v1/drafts/:id/archive";

// Turns a route template into a URL that exists in the seed.
function concreteUrl(template: string): string {
  return template
    .replace(":name", "investimentos-base")
    .replace(":version", "1.1.0")
    .replace(":slug", "investimentos-api")
    .replace(":id", "00000000-0000-0000-0000-000000000000");
}

const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

interface CreatedToken {
  id: string;
  name: string;
  token: string;
  created_at: string;
  expires_at: string;
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createToken(app: FastifyInstance, jwt: string, name = "notebook"): Promise<CreatedToken> {
  const response = await app.inject({ method: "POST", url: TOKENS, headers: bearer(jwt), payload: { name } });
  if (response.statusCode !== 201) throw new Error(`create answered ${response.statusCode}: ${response.body}`);
  return response.json<CreatedToken>();
}

describe("gateway tokens", () => {
  let db: Db;
  let app: FastifyInstance;
  let jwt: string;

  beforeEach(async () => {
    const fixture = await marketplaceFixture();
    db = fixture.db;
    app = testServer(db, "local", fixture.storage);
    jwt = await login(app, DEV);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  const get = (url: string, token: string) => app.inject({ method: "GET", url, headers: bearer(token) });

  it("POST creates a token shown once, valid for the configured days, stored only as its sha256", async () => {
    const response = await app.inject({ method: "POST", url: TOKENS, headers: bearer(jwt), payload: { name: "notebook" } });

    expect(response.statusCode).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    const created = response.json<CreatedToken>();
    expect(Object.keys(created).sort()).toEqual(["created_at", "expires_at", "id", "name", "token"]);
    expect(created.name).toBe("notebook");
    expect(created.token).toMatch(/^shg_[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(created.expires_at) - Date.parse(created.created_at)).toBe(TEST_GATEWAY_TOKEN_TTL_DAYS * DAY_MS);

    const row = db.prepare("SELECT * FROM gateway_tokens WHERE id = ?").get(created.id) as Record<string, unknown>;
    expect(row).toEqual({
      id: created.id,
      user_id: userId(db, DEV),
      name: "notebook",
      token_hash: sha256Hex(created.token),
      created_at: created.created_at,
      expires_at: created.expires_at,
      revoked_at: null,
    });
  });

  it("a client cannot choose the token value: an extra field is ignored", async () => {
    const response = await app.inject({
      method: "POST",
      url: TOKENS,
      headers: bearer(jwt),
      payload: { name: "notebook", token: `shg_${"A".repeat(43)}` },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().token).not.toBe(`shg_${"A".repeat(43)}`);
  });

  it("two tokens never share a value", async () => {
    const first = await createToken(app, jwt);
    const second = await createToken(app, jwt);

    expect(first.token).not.toBe(second.token);
  });

  it.each([
    ["an empty name", { name: "" }],
    ["a blank name", { name: "   " }],
    ["a name over 100 characters", { name: "x".repeat(101) }],
    ["no name", {}],
  ])("POST with %s answers 400", async (_case, payload) => {
    const response = await app.inject({ method: "POST", url: TOKENS, headers: bearer(jwt), payload });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "validation_failed" });
  });

  it("the created token authenticates the setup-plan and the archive download", async () => {
    const { token } = await createToken(app, jwt);

    const planWithToken = await get(SETUP_PLAN, token);
    const planWithJwt = await get(SETUP_PLAN, jwt);
    expect(planWithToken.statusCode).toBe(200);
    expect(planWithToken.json()).toEqual(planWithJwt.json());

    const archive = await get(ARCHIVE, token);
    expect(archive.statusCode).toBe(200);
    expect(archive.headers["content-type"]).toBe("application/gzip");
    expect(archive.headers["x-package-digest"]).toBe(`sha256:${createHash("sha256").update(archive.rawPayload).digest("hex")}`);
  });

  it("the token keeps the owner's squad scope: another squad's setup-plan answers 404", async () => {
    const { token } = await createToken(app, jwt);

    expect((await get("/v1/projects/cartoes-app/setup-plan", token)).statusCode).toBe(404);
  });

  it("every product read accepts the token; every other GET route answers 401", async () => {
    const { token } = await createToken(app, jwt);
    const gets = registeredRoutes(app).filter((route) => route.method === "GET");
    expect(gets.map((route) => route.url)).toEqual(expect.arrayContaining(GATEWAY_TOKEN_READS));

    for (const route of gets) {
      const response = await get(concreteUrl(route.url), token);
      if (GATEWAY_TOKEN_READS.includes(route.url)) {
        expect(response.statusCode, route.url).toBe(200);
      } else if (route.url === GATEWAY_TOKEN_DRAFT_ARCHIVE) {
        expect(response.statusCode, route.url).toBe(404);
        expect(response.json().code, route.url).toBe("not_found");
      } else {
        expect(response.statusCode, route.url).toBe(401);
        expect(response.json().code, route.url).toBe("gateway_token_not_allowed");
      }
    }
  });

  it("a revoked token answers 401", async () => {
    const created = await createToken(app, jwt);
    expect((await get(SETUP_PLAN, created.token)).statusCode).toBe(200);

    const revoke = await app.inject({ method: "DELETE", url: `${TOKENS}/${created.id}`, headers: bearer(jwt) });
    expect(revoke.statusCode).toBe(204);

    const response = await get(SETUP_PLAN, created.token);
    expect(response.statusCode).toBe(401);
    expect(response.headers["www-authenticate"]).toBe('Bearer realm="smart-harness"');
    expect(response.json()).toMatchObject({ status: 401, code: "invalid_token" });
  });

  it("an expired token answers 401", async () => {
    const created = await createToken(app, jwt);
    db.prepare("UPDATE gateway_tokens SET created_at = ?, expires_at = ? WHERE id = ?").run(
      "2020-01-01T00:00:00.000Z",
      "2020-03-31T00:00:00.000Z",
      created.id,
    );

    const response = await get(SETUP_PLAN, created.token);
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "invalid_token" });
  });

  it.each([
    ["an unknown token", `shg_${"A".repeat(43)}`],
    ["a malformed token", "shg_short"],
  ])("%s answers 401", async (_case, token) => {
    const response = await get(SETUP_PLAN, token);

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "invalid_token" });
  });

  it("removing a membership cuts the token's access on the next request", async () => {
    const { token } = await createToken(app, jwt);
    db.prepare("DELETE FROM memberships WHERE user_id = ? AND tenant_id = (SELECT id FROM tenants WHERE slug = 'investimentos')")
      .run(userId(db, DEV));

    expect((await get(SETUP_PLAN, token)).statusCode).toBe(404);
  });

  it("with the gateway token, POST, PATCH, PUT and DELETE answer 401 on every registered route", async () => {
    const created = await createToken(app, jwt);
    const routes = registeredRoutes(app);
    const writes = routes.filter((route) => ["POST", "PATCH", "PUT", "DELETE"].includes(route.method));
    expect(writes).toEqual(
      expect.arrayContaining([
        { method: "POST", url: "/v1/auth/dev-login" },
        { method: "POST", url: TOKENS },
        { method: "DELETE", url: `${TOKENS}/:id` },
      ]),
    );
    const urls = [...new Set(routes.map((route) => route.url))];

    for (const url of urls) {
      for (const method of ["POST", "PATCH", "PUT", "DELETE"] as const) {
        const target = url === `${TOKENS}/:id` ? `${TOKENS}/${created.id}` : concreteUrl(url);
        const response = await app.inject({ method, url: target, headers: bearer(created.token), payload: { name: "x" } });
        expect(response.statusCode, `${method} ${url}`).toBe(401);
        expect(response.json().code, `${method} ${url}`).toBe("gateway_token_not_allowed");
      }
    }

    // Nothing was written: one token, not revoked, and only the creation in the audit trail.
    expect(db.prepare("SELECT id, revoked_at FROM gateway_tokens").all()).toEqual([{ id: created.id, revoked_at: null }]);
    expect(db.prepare("SELECT action FROM audit_events ORDER BY id").all()).toEqual([
      { action: "auth.dev_login" },
      { action: "gateway_token.created" },
    ]);
    // A catalog read with the same token still works.
    expect((await get("/v1/marketplace", created.token)).statusCode).toBe(200);
  });

  it("listing tokens: the owner's JWT answers 200, the gateway token answers 401", async () => {
    const created = await createToken(app, jwt);

    const withJwt = await get(TOKENS, jwt);
    expect(withJwt.statusCode).toBe(200);
    expect(withJwt.json()).toEqual({
      items: [
        { id: created.id, name: "notebook", created_at: created.created_at, expires_at: created.expires_at, revoked_at: null },
      ],
      next_cursor: null,
    });
    expect(withJwt.body).not.toContain(created.token);
    expect(withJwt.body).not.toContain(sha256Hex(created.token));

    const withToken = await get(TOKENS, created.token);
    expect(withToken.statusCode).toBe(401);
    expect(withToken.json()).toMatchObject({ code: "gateway_token_not_allowed" });
  });

  it("the list pages newest first with a cursor and keeps revoked tokens with revoked_at", async () => {
    const ids: string[] = [];
    for (const name of ["a", "b", "c"]) ids.push((await createToken(app, jwt, name)).id);
    await app.inject({ method: "DELETE", url: `${TOKENS}/${ids[0]}`, headers: bearer(jwt) });

    const first = (await get(`${TOKENS}?limit=2`, jwt)).json();
    expect(first.items).toHaveLength(2);
    expect(first.next_cursor).toEqual(expect.any(String));
    const second = (await get(`${TOKENS}?limit=2&cursor=${first.next_cursor}`, jwt)).json();
    expect(second.items).toHaveLength(1);
    expect(second.next_cursor).toBeNull();

    const items = [...first.items, ...second.items] as { id: string; created_at: string; revoked_at: string | null }[];
    expect(items.map((item) => item.id).sort()).toEqual([...ids].sort());
    const createdAt = items.map((item) => item.created_at);
    expect(createdAt).toEqual([...createdAt].sort().reverse());
    expect(items.find((item) => item.id === ids[0])?.revoked_at).toEqual(expect.any(String));
  });

  it("an invalid cursor answers 400", async () => {
    const cursor = Buffer.from(JSON.stringify({ k: "no-separator" })).toString("base64url");

    const response = await get(`${TOKENS}?cursor=${cursor}`, jwt);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "invalid_cursor" });
  });

  it("revoking with the gateway token answers 401 and leaves the token active", async () => {
    const created = await createToken(app, jwt);

    const response = await app.inject({ method: "DELETE", url: `${TOKENS}/${created.id}`, headers: bearer(created.token) });
    expect(response.statusCode).toBe(401);
    expect((await get(SETUP_PLAN, created.token)).statusCode).toBe(200);
  });

  it("revoking twice answers 204 both times and audits once; an unknown id answers 404", async () => {
    const created = await createToken(app, jwt);
    const revoke = (id: string) => app.inject({ method: "DELETE", url: `${TOKENS}/${id}`, headers: bearer(jwt) });

    expect((await revoke(created.id)).statusCode).toBe(204);
    const revokedAt = (db.prepare("SELECT revoked_at FROM gateway_tokens WHERE id = ?").get(created.id) as { revoked_at: string }).revoked_at;
    expect((await revoke(created.id)).statusCode).toBe(204);
    expect(db.prepare("SELECT revoked_at FROM gateway_tokens WHERE id = ?").get(created.id)).toEqual({ revoked_at: revokedAt });
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'gateway_token.revoked'").get()).toEqual({ n: 1 });

    const missing = await revoke("does-not-exist");
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: "not_found" });
  });

  it("a DEV neither sees nor revokes another DEV's token (404, like a missing one)", async () => {
    const mine = await createToken(app, jwt);
    const otherJwt = await login(app, DEV_CARTOES);
    const theirs = await createToken(app, otherJwt, "theirs");

    const list = (await get(TOKENS, otherJwt)).json<{ items: { id: string }[] }>();
    expect(list.items.map((item) => item.id)).toEqual([theirs.id]);

    const revoke = await app.inject({ method: "DELETE", url: `${TOKENS}/${mine.id}`, headers: bearer(otherJwt) });
    const missing = await app.inject({ method: "DELETE", url: `${TOKENS}/does-not-exist`, headers: bearer(otherJwt) });
    expect(revoke.statusCode).toBe(404);
    expect(revoke.json().detail).toBe(missing.json().detail);
    expect((await get(SETUP_PLAN, mine.token)).statusCode).toBe(200);
    expect(db.prepare("SELECT revoked_at FROM gateway_tokens WHERE id = ?").get(mine.id)).toEqual({ revoked_at: null });
  });

  it("the audit trail records creation and revocation without the token or its hash", async () => {
    const created = await createToken(app, jwt);
    await app.inject({ method: "DELETE", url: `${TOKENS}/${created.id}`, headers: bearer(jwt) });

    const events = db
      .prepare("SELECT actor_user_id, tenant_id, action, details FROM audit_events WHERE action LIKE 'gateway_token.%' ORDER BY id")
      .all() as { actor_user_id: string; tenant_id: null; action: string; details: string }[];
    expect(events.map(({ details, ...event }) => ({ ...event, details: JSON.parse(details) }))).toEqual([
      {
        actor_user_id: userId(db, DEV),
        tenant_id: null,
        action: "gateway_token.created",
        details: { token_id: created.id, name: "notebook", expires_at: created.expires_at },
      },
      { actor_user_id: userId(db, DEV), tenant_id: null, action: "gateway_token.revoked", details: { token_id: created.id } },
    ]);
    const everything = JSON.stringify(db.prepare("SELECT * FROM audit_events").all());
    expect(everything).not.toContain(created.token);
    expect(everything).not.toContain(sha256Hex(created.token));
  });
});

describe("gateway tokens never leak", () => {
  it("the token does not appear in the logs, even at trace level", async () => {
    const { db, storage } = await marketplaceFixture();
    const lines: string[] = [];
    const app = testServer(db, "local", storage, { write: (line) => void lines.push(line) });
    try {
      const jwt = await login(app, DEV);
      const created = await createToken(app, jwt);
      await app.inject({ method: "GET", url: SETUP_PLAN, headers: bearer(created.token) });
      await app.inject({ method: "POST", url: TOKENS, headers: bearer(created.token), payload: { name: "x" } });
      await app.inject({ method: "DELETE", url: `${TOKENS}/${created.id}`, headers: bearer(jwt) });
      await app.inject({ method: "GET", url: SETUP_PLAN, headers: bearer(created.token) });

      const logs = lines.join("");
      expect(logs).toContain("incoming request");
      expect(logs).not.toContain(created.token);
      expect(logs).not.toContain(created.token.slice(4));
      expect(logs).not.toContain(sha256Hex(created.token));
    } finally {
      await app.close();
      db.close();
    }
  });

  it("the token does not appear in the SQLite file; only its hash does", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gateway-tokens-"));
    const file = join(dir, "control-plane.sqlite");
    const db = openDatabase(file);
    try {
      runMigrations(db);
      seedLocalData(db);
      const app = testServer(db);
      const created = await createToken(app, await login(app, DEV));
      await app.close();
      db.close();

      const bytes = Buffer.concat(
        [file, `${file}-wal`].filter((path) => existsSync(path)).map((path) => readFileSync(path)),
      );
      expect(bytes.includes(created.token)).toBe(false);
      expect(bytes.includes(created.token.slice(4))).toBe(false);
      expect(bytes.includes(sha256Hex(created.token))).toBe(true);
    } finally {
      if (db.open) db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
