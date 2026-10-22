import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { personalResourcesFromEnv, PERSONAL_DEV, seedPersonalData } from "../../seed/personal-data.ts";
import { seedPersonalMarketplace } from "../../seed/personal-marketplace.ts";
import { openDatabase, type Db } from "../../src/db/database.ts";
import { runMigrations } from "../../src/db/migrate.ts";
import { upsertProject, upsertTenant } from "../../src/db/repos/seed.ts";
import { createPackageStorage } from "../../src/storage/packages.ts";
import { FakeS3, login, TEST_BUCKET, testServer } from "../test-support.ts";

const EXPECTED = ["code-review", "deja-vu", "github", "graphify", "md2poui", "notion", "trello"];

describe("personal demo seed", () => {
  let db: Db;
  let app: FastifyInstance | undefined;
  beforeEach(() => { db = openDatabase(":memory:"); runMigrations(db); });
  afterEach(async () => { await app?.close(); app = undefined; db.close(); });

  it("starts with zero projects and denies all connectors without explicit demo resources", () => {
    seedPersonalData(db);
    expect(db.prepare("SELECT * FROM projects").all()).toEqual([]);
    expect(db.prepare("SELECT * FROM user_gateway_permissions").all()).toEqual([]);
    expect(personalResourcesFromEnv({ GITHUB_REPOS: "legacy/repo", TRELLO_BOARD_ID: "legacyBoard" })).toEqual({});
    expect(personalResourcesFromEnv({ DEMO_GITHUB_REPO: "Demo/Repo", DEMO_NOTION_PAGE_IDS: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }))
      .toEqual({ github: ["demo/repo"], notion: ["aaaaaaaabbbbccccddddeeeeeeeeeeee"] });
  });

  it("replaces only the seeded developer's grants and preserves existing projects", () => {
    const tenantId = upsertTenant(db, { slug: "old", name: "Existing" });
    upsertProject(db, tenantId, { slug: "existing", name: "Existing project", description: "Keep" });
    seedPersonalData(db, { github: ["demo/first"], trello: ["board"] });
    seedPersonalData(db, { github: ["demo/second"] });
    const rows = db.prepare(`SELECT u.email, p.server, p.resource_id FROM user_gateway_permissions p JOIN users u ON u.id = p.user_id`).all();
    expect(rows).toEqual([{ email: PERSONAL_DEV, server: "github", resource_id: "demo/second" }]);
    expect(db.prepare("SELECT slug FROM projects").all()).toEqual([{ slug: "existing" }]);
    seedPersonalData(db);
    expect(db.prepare("SELECT * FROM user_gateway_permissions").all()).toEqual([]);
  });

  it("publishes exactly five connectors and two skill packages, with no agents or projects", async () => {
    seedPersonalData(db);
    const storage = createPackageStorage(new FakeS3([TEST_BUCKET]), TEST_BUCKET);
    expect(await seedPersonalMarketplace({ db, storage })).toEqual({ created: 7, unchanged: 0, storedArchives: 7 });
    expect(await seedPersonalMarketplace({ db, storage })).toEqual({ created: 0, unchanged: 7, storedArchives: 0 });
    const server = testServer(db, "local", storage);
    app = server;
    const headers = { authorization: `Bearer ${await login(server, PERSONAL_DEV)}` };
    const get = (url: string) => server.inject({ method: "GET", url, headers });
    const me = (await get("/v1/me")).json();
    expect(me.user).toMatchObject({ email: PERSONAL_DEV, job_title: "Software Engineer" });
    expect(me.memberships[0].role).toBe("DEV");
    expect((await get("/v1/workspace")).json().projects).toEqual([]);
    const catalog = (await get("/v1/marketplace")).json();
    expect(catalog.items.map((item: { plugin: { name: string } }) => item.plugin.name)).toEqual(EXPECTED);
    expect(catalog.items.find((item: { plugin: { name: string } }) => item.plugin.name === "md2poui").version.version).toBe("1.0.1");
    expect(catalog.items.find((item: { plugin: { name: string } }) => item.plugin.name === "code-review").version.version).toBe("1.1.1");
    for (const [type, count] of [["connector", 5], ["skill", 2], ["agent", 0]] as const) {
      expect((await get(`/v1/marketplace?type=${type}`)).json().items).toHaveLength(count);
    }
    expect((await get("/v1/me/setup-plan")).json().optional).toEqual(catalog);
    for (const item of catalog.items) {
      const download = await get(item.version.archive_url);
      expect(download.statusCode).toBe(200);
      expect(download.headers["x-package-digest"]).toBe(item.version.digest);
      expect(download.rawPayload.length).toBe(item.version.size_bytes);
    }
  });
});
