import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../db/database.ts";
import { upsertUser } from "../../db/repos/seed.ts";
import { login, marketplaceFixture, TEST_GATEWAY_URL, TEST_SECRET, testServer } from "../../test-support.ts";

const DEV = "dev@smart-harness.local"; // DEV in investimentos and conta
const OUTSIDER = "outsider@smart-harness.local";

// Key names that would mean a credential leaked into a response.
const SECRET_KEY = /token|secret|password|credential|authorization|api[-_]?key/i;

function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => [key, ...keysOf(child)]);
  }
  return [];
}

describe("workspace and setup-plan", () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    const fixture = await marketplaceFixture();
    db = fixture.db;
    upsertUser(db, { email: OUTSIDER, name: "Outsider" });
    app = testServer(db, "local", fixture.storage);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  async function get(email: string, url: string) {
    const token = await login(app, email);
    const response = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
    return { response, token };
  }

  it("GET /v1/workspace lists the caller's projects with baseline and component counts", async () => {
    const { response } = await get(DEV, "/v1/workspace");

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.user.email).toBe(DEV);
    expect(body.projects).toEqual([
      {
        slug: "conta-digital",
        name: "Conta Digital",
        description: "Digital account backend.",
        tenant: { slug: "conta", name: "Conta" },
        counts: { agent: 1, skill: 1, mcp: 1 },
        baseline: [{ plugin: "conta-base", version: "1.0.0" }],
      },
      {
        slug: "investimentos-api",
        name: "Investimentos API",
        description: "Investment orders and portfolio API.",
        tenant: { slug: "investimentos", name: "Investimentos" },
        counts: { agent: 1, skill: 2, mcp: 1 },
        baseline: [{ plugin: "investimentos-base", version: "1.1.0" }],
      },
    ]);
  });

  it("GET /v1/workspace for a user without memberships has no projects", async () => {
    const { response } = await get(OUTSIDER, "/v1/workspace");

    expect(response.statusCode).toBe(200);
    expect(response.json().projects).toEqual([]);
  });

  it("the setup-plan has the pinned baseline, the optionals of the squad and the gateway URL", async () => {
    const { response } = await get(DEV, "/v1/projects/investimentos-api/setup-plan");

    expect(response.statusCode).toBe(200);
    const plan = response.json();
    expect(plan.project).toMatchObject({ slug: "investimentos-api", tenant: { slug: "investimentos" } });
    expect(plan.gateway).toEqual({ url: TEST_GATEWAY_URL });
    expect(plan.baseline.map((entry: { plugin: { name: string }; version: { version: string } }) =>
      `${entry.plugin.name}@${entry.version.version}`)).toEqual(["investimentos-base@1.1.0"]);
    expect(plan.baseline[0].version.archive_url).toBe("/v1/plugins/investimentos-base/versions/1.1.0/archive");
    // conta-base is visible to the caller (DEV in conta) but not to the investimentos squad.
    expect(plan.optional.items.map((entry: { plugin: { name: string } }) => entry.plugin.name)).toEqual(["code-review"]);
    expect(plan.optional.next_cursor).toBeNull();
  });

  it("the setup-plan never carries a token or other secret", async () => {
    const { response, token } = await get(DEV, "/v1/projects/investimentos-api/setup-plan");

    expect(response.body).not.toContain(token);
    expect(response.body).not.toContain(new TextDecoder().decode(TEST_SECRET));
    expect(keysOf(response.json()).filter((key) => SECRET_KEY.test(key))).toEqual([]);
  });

  it("the setup-plan of another squad's project answers 404, like a missing project", async () => {
    const other = await get(DEV, "/v1/projects/cartoes-app/setup-plan");
    const missing = await get(DEV, "/v1/projects/does-not-exist/setup-plan");

    expect(other.response.statusCode).toBe(404);
    expect(missing.response.statusCode).toBe(404);
    expect(other.response.json().detail).toBe(missing.response.json().detail);
    expect(other.response.body).not.toContain("cartoes-base");
  });

  it("a user without memberships gets 404 for every setup-plan", async () => {
    for (const slug of ["investimentos-api", "conta-digital", "cartoes-app"]) {
      const { response } = await get(OUTSIDER, `/v1/projects/${slug}/setup-plan`);
      expect(response.statusCode, slug).toBe(404);
    }
  });
});
