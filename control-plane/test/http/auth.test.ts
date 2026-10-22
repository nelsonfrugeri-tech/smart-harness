import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/database.ts";
import { findProjectBySlug } from "../../src/db/repos/projects.ts";
import { upsertUser } from "../../src/db/repos/seed.ts";
import { login, seededDatabase, TEST_SECRET, tenantId, testServer, userId } from "../test-support.ts";
import { authenticate } from "../../src/http/auth.ts";
import { notFound } from "../../src/http/problem.ts";

const DEV = "dev@smart-harness.local";
const DEV_CARTOES = "dev.cartoes@smart-harness.local";

// Same chain a tenant resource route uses: authenticate, scoped repository, 404 when absent.
// The public project routes arrive with the Marketplace (#7).
function withProjectProbe(app: FastifyInstance, db: Db): FastifyInstance {
  app.get<{ Params: { slug: string } }>("/test/projects/:slug", async (request) => {
    const principal = await authenticate(request, { db, jwtSecret: TEST_SECRET });
    const project = findProjectBySlug(db, principal.scope, request.params.slug);
    if (!project) {
      throw notFound(`project ${request.params.slug} not found`);
    }
    return project;
  });
  return app;
}

function get(app: FastifyInstance, url: string, token?: string) {
  return app.inject({
    method: "GET",
    url,
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
}

describe("dev-login and /v1/me", () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(() => {
    db = seededDatabase();
    app = withProjectProbe(testServer(db), db);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("dev-login issues a bearer token and records an audit event", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/dev-login",
      payload: { email: "DEV@Smart-Harness.local" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ token_type: "Bearer", expires_in: 3600 });
    expect(body.access_token.split(".")).toHaveLength(3);
    expect(db.prepare("SELECT actor_user_id, action, tenant_id FROM audit_events").all()).toEqual([
      { actor_user_id: userId(db, DEV), action: "auth.dev_login", tenant_id: null },
    ]);
  });

  it("GET /v1/me returns the user and memberships with roles", async () => {
    const response = await get(app, "/v1/me", await login(app, DEV));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: { id: userId(db, DEV), email: DEV, name: "Dev", job_title: null },
      memberships: [
        { tenant: { id: tenantId(db, "conta"), slug: "conta", name: "Conta" }, role: "DEV" },
        { tenant: { id: tenantId(db, "investimentos"), slug: "investimentos", name: "Investimentos" }, role: "DEV" },
      ],
    });
  });

  it("a DEV reads a project of their squad", async () => {
    const response = await get(app, "/test/projects/investimentos-api", await login(app, DEV));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ slug: "investimentos-api" });
  });

  it("a DEV gets 404 for a project of another squad, same as a missing one", async () => {
    const token = await login(app, DEV);

    const otherSquad = await get(app, "/test/projects/cartoes-app", token);
    const missing = await get(app, "/test/projects/does-not-exist", token);

    expect(otherSquad.statusCode).toBe(404);
    expect(otherSquad.headers["content-type"]).toContain("application/problem+json");
    expect(otherSquad.json()).toMatchObject({ status: 404, code: "not_found" });
    expect(missing.statusCode).toBe(404);
  });

  it("a user without memberships sees no tenant and no project", async () => {
    const id = upsertUser(db, { email: "lonely@smart-harness.local", name: "Lonely" });
    const token = await login(app, "lonely@smart-harness.local");

    const me = await get(app, "/v1/me", token);
    expect(me.json()).toEqual({ user: { id, email: "lonely@smart-harness.local", name: "Lonely", job_title: null }, memberships: [] });
    for (const slug of ["investimentos-api", "conta-digital", "cartoes-app"]) {
      expect((await get(app, `/test/projects/${slug}`, token)).statusCode).toBe(404);
    }
  });

  it("removing a membership revokes access on the next request with the same JWT", async () => {
    const token = await login(app, DEV_CARTOES);
    expect((await get(app, "/test/projects/cartoes-app", token)).statusCode).toBe(200);

    db.prepare("DELETE FROM memberships WHERE user_id = ? AND tenant_id = ?").run(
      userId(db, DEV_CARTOES),
      tenantId(db, "cartoes"),
    );

    expect((await get(app, "/test/projects/cartoes-app", token)).statusCode).toBe(404);
    expect((await get(app, "/v1/me", token)).json().memberships).toEqual([]);
  });

  it("dev-login with an unknown e-mail answers 401", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/dev-login",
      payload: { email: "nobody@smart-harness.local" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "unknown_user" });
  });

  it("dev-login with an invalid body answers 400 with field errors", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/auth/dev-login", payload: { email: "not-an-email" } });

    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toMatchObject({
      code: "validation_failed",
      errors: [{ path: "/email", message: expect.any(String) }],
    });
  });
});

describe("rejected tokens answer 401 problem+json", () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(() => {
    db = seededDatabase();
    app = testServer(db);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  function signed(secret: Uint8Array, claims: { sub?: string; exp?: number; iss?: string; aud?: string }) {
    const jwt = new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setIssuedAt();
    jwt.setIssuer(claims.iss ?? "smart-harness-control-plane").setAudience(claims.aud ?? "smart-harness");
    if (claims.sub !== undefined) jwt.setSubject(claims.sub);
    jwt.setExpirationTime(claims.exp ?? Math.floor(Date.now() / 1000) + 600);
    return jwt.sign(secret);
  }

  const cases: [string, (db: Db) => Promise<string | undefined>, string][] = [
    ["no Authorization header", async () => undefined, "missing_token"],
    ["a malformed token", async () => "not-a-jwt", "invalid_token"],
    ["a token signed with another secret", (db) => signed(new TextEncoder().encode("x".repeat(40)), { sub: userId(db, DEV) }), "invalid_token"],
    ["an expired token", (db) => signed(TEST_SECRET, { sub: userId(db, DEV), exp: Math.floor(Date.now() / 1000) - 60 }), "invalid_token"],
    ["a token for another audience", (db) => signed(TEST_SECRET, { sub: userId(db, DEV), aud: "other" }), "invalid_token"],
    ["a token without subject", () => signed(TEST_SECRET, {}), "invalid_token"],
    ["a token for a deleted user", () => signed(TEST_SECRET, { sub: "00000000-0000-0000-0000-000000000000" }), "invalid_token"],
  ];

  for (const [name, makeToken, code] of cases) {
    it(name, async () => {
      const response = await get(app, "/v1/me", await makeToken(db));

      expect(response.statusCode).toBe(401);
      expect(response.headers["content-type"]).toContain("application/problem+json");
      expect(response.headers["www-authenticate"]).toBe('Bearer realm="smart-harness"');
      expect(response.json()).toMatchObject({ type: "about:blank", title: "Unauthorized", status: 401, code });
    });
  }
});
