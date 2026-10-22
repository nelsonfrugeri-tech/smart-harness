import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../../src/db/database.ts";
import { upsertUser } from "../../../src/db/repos/seed.ts";
import { login, marketplaceFixture, TEST_GATEWAY_URL, TEST_SECRET, testServer } from "../../test-support.ts";

const DEV = "dev@smart-harness.local"; // DEV in investimentos and conta
const ADMIN = "admin@smart-harness.local"; // ADMIN in every squad
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
        counts: { agent: 2, skill: 3, mcp: 4 },
        baseline: [{ plugin: "investimentos-base", version: "1.2.1" }],
      },
      {
        slug: "md2poui",
        name: "TOTVS md2poui",
        description: "TypeScript CLI demo: turn Markdown into PO-UI components.",
        tenant: { slug: "investimentos", name: "Investimentos" },
        counts: { agent: 2, skill: 2, mcp: 4 },
        baseline: [{ plugin: "md2poui-base", version: "1.0.0" }],
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
      `${entry.plugin.name}@${entry.version.version}`)).toEqual(["investimentos-base@1.2.1"]);
    expect(plan.baseline[0]).toMatchObject({ type: "agent", keywords: [] });
    expect(plan.baseline[0].version.archive_url).toBe("/v1/plugins/investimentos-base/versions/1.2.1/archive");
    // conta-base is visible to the caller (DEV in conta) but not to the investimentos squad.
    expect(plan.optional.items.map((entry: { plugin: { name: string } }) => entry.plugin.name)).toEqual(["code-review", "deja-vu", "github-connector", "graphify", "md2poui-base", "md2poui-development", "md2poui-review"]);
    expect(plan.optional.next_cursor).toBeNull();
  });

  it("md2poui installs both agents and their own skills in one pinned baseline", async () => {
    const { response } = await get(DEV, "/v1/projects/md2poui/setup-plan");
    expect(response.statusCode).toBe(200);
    const plan = response.json();
    expect(plan.baseline).toHaveLength(1);
    expect(plan.baseline[0]).toMatchObject({
      plugin: { name: "md2poui-base" }, type: "agent",
      version: { version: "1.0.0", archive_url: "/v1/plugins/md2poui-base/versions/1.0.0/archive" },
      keywords: ["claude-code", "totvs", "md2poui", "typescript", "development", "review"],
    });
    expect(plan.baseline[0].components.filter((c: { kind: string }) => c.kind === "agent").map((c: { name: string }) => c.name)).toEqual(["developer", "reviewer"]);
    expect(plan.baseline[0].components.filter((c: { kind: string }) => c.kind === "skill").map((c: { name: string }) => c.name)).toEqual(["md2poui-development", "md2poui-review"]);
  });

  it("md2poui exposes managed local tools as optional skills with downloadable archives", async () => {
    const { response } = await get(DEV, "/v1/projects/md2poui/setup-plan");
    expect(response.statusCode).toBe(200);
    const optionals = response.json().optional.items;
    for (const name of ["graphify", "deja-vu"]) {
      const entry = optionals.find((item: { plugin: { name: string } }) => item.plugin.name === name);
      expect(entry).toMatchObject({ plugin: { name }, type: "skill", version: { version: "1.0.0" } });
      expect(entry.keywords).toContain("claude-code");
      expect(entry.components.map((component: { kind: string; name: string }) => `${component.kind}:${component.name}`)).toEqual([`skill:${name}`]);
      const archive = await get(DEV, entry.version.archive_url);
      expect(archive.response.statusCode).toBe(200);
    }
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

  describe("PUT /v1/projects/{slug}/baseline/{plugin}", () => {
    const BASELINE_URL = "/v1/projects/investimentos-api/baseline/investimentos-base";

    async function pin(email: string, version: string, url = BASELINE_URL) {
      const token = await login(app, email);
      return app.inject({ method: "PUT", url, headers: { authorization: `Bearer ${token}` }, payload: { version } });
    }

    const pinnedInPlan = async () =>
      (await get(DEV, "/v1/projects/investimentos-api/setup-plan")).response
        .json()
        .baseline.map((entry: { plugin: { name: string }; version: { version: string; digest: string } }) => ({
          plugin: entry.plugin.name,
          version: entry.version.version,
          digest: entry.version.digest,
        }));

    it("an ADMIN rolls the baseline back to an older version and the setup-plan carries it", async () => {
      expect((await pinnedInPlan()).map((entry: { version: string }) => entry.version)).toEqual(["1.2.1"]);
      const older = db
        .prepare(
          `SELECT v.digest FROM plugin_versions v JOIN plugins p ON p.id = v.plugin_id
            WHERE p.name = 'investimentos-base' AND v.version = '1.0.0'`,
        )
        .get() as { digest: string };

      const response = await pin(ADMIN, "1.0.0");

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ plugin: "investimentos-base", version: "1.0.0" });
      expect(await pinnedInPlan()).toEqual([{ plugin: "investimentos-base", version: "1.0.0", digest: older.digest }]);
      const audit = db.prepare("SELECT details FROM audit_events WHERE action = 'baseline.pinned'").all() as {
        details: string;
      }[];
      expect(audit.map((row) => JSON.parse(row.details))).toEqual([
        { project: "investimentos-api", plugin: "investimentos-base", version: "1.0.0" },
      ]);
    });

    it("a DEV gets 403 and the baseline stays", async () => {
      const response = await pin(DEV, "1.0.0");

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe("forbidden");
      expect((await pinnedInPlan()).map((entry: { version: string }) => entry.version)).toEqual(["1.2.1"]);
    });

    it("an unknown version answers 404; another squad's project answers 404", async () => {
      expect((await pin(ADMIN, "9.9.9")).statusCode).toBe(404);
      expect((await pin(DEV, "1.0.0", "/v1/projects/cartoes-app/baseline/cartoes-base")).statusCode).toBe(404);
    });
  });
});
