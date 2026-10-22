import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../../src/db/database.ts";
import { login, marketplaceFixture, testServer, TEST_GATEWAY_URL, userId } from "../../test-support.ts";

const DEV = "dev@smart-harness.local";

describe("personal setup plan", () => {
  let db: Db;
  let app: FastifyInstance;
  let token: string;
  beforeEach(async () => {
    const fixture = await marketplaceFixture();
    db = fixture.db;
    app = testServer(db, "local", fixture.storage);
    const loginToken = await login(app, DEV);
    const created = await app.inject({ method: "POST", url: "/v1/me/gateway-tokens",
      headers: { authorization: `Bearer ${loginToken}` }, payload: { name: "personal CLI" } });
    token = created.json().token;
  });
  afterEach(async () => { await app.close(); db.close(); });
  const get = (url: string, credential = token) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${credential}` } });

  it("uses the caller's marketplace visibility and pagination without any project", async () => {
    const plan = await get("/v1/me/setup-plan?limit=2");
    expect(plan.statusCode).toBe(200);
    const catalog = await get("/v1/marketplace?limit=2");
    expect(plan.json()).toEqual({ gateway: { url: TEST_GATEWAY_URL }, optional: catalog.json() });
    expect(plan.json()).not.toHaveProperty("project");
    const cursor = encodeURIComponent(plan.json().optional.next_cursor);
    const next = await get(`/v1/me/setup-plan?limit=2&cursor=${cursor}`);
    const nextCatalog = await get(`/v1/marketplace?limit=2&cursor=${cursor}`);
    expect(next.json().optional).toEqual(nextCatalog.json());
    expect(next.json().optional.items[0]).not.toEqual(plan.json().optional.items[0]);
  });

  it("supports marketplace filters and rejects invalid cursors", async () => {
    for (const query of ["type=skill", "kind=mcp", "q=review"]) {
      const plan = await get(`/v1/me/setup-plan?${query}`);
      expect(plan.statusCode).toBe(200);
      expect(plan.json().optional).toEqual((await get(`/v1/marketplace?${query}`)).json());
    }
    expect((await get("/v1/me/setup-plan?cursor=invalid")).statusCode).toBe(400);
  });

  it("revokes access on the next request and exposes no packages without membership", async () => {
    db.prepare("DELETE FROM memberships WHERE user_id = ?").run(userId(db, DEV));
    const empty = await get("/v1/me/setup-plan");
    expect(empty.statusCode).toBe(200);
    expect(empty.json().optional).toEqual({ items: [], next_cursor: null });
    db.prepare("UPDATE gateway_tokens SET revoked_at = '2026-01-01T00:00:00.000Z' WHERE user_id = ?").run(userId(db, DEV));
    expect((await get("/v1/me/setup-plan")).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/me/setup-plan" })).statusCode).toBe(401);
  });
});
