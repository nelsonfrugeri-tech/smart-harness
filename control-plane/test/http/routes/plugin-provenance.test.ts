import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../../src/db/database.ts";
import { setPluginProvenance } from "../../../src/db/repos/seed.ts";
import { login, marketplaceFixture, tenantId, testServer } from "../../test-support.ts";

const REPOSITORY = "https://github.com/example/catalog-fixture";

describe("persisted plugin provenance", () => {
  let db: Db;
  let app: FastifyInstance;
  let headers: { authorization: string };
  beforeEach(async () => {
    const fixture = await marketplaceFixture();
    db = fixture.db;
    app = testServer(db, "local", fixture.storage);
    headers = { authorization: `Bearer ${await login(app, "dev@smart-harness.local")}` };
  });
  afterEach(async () => { await app.close(); db.close(); });
  const get = (url: string) => app.inject({ method: "GET", url, headers });

  it("omits unknown provenance from earlier publications", async () => {
    const response = await get("/v1/plugins/investimentos-base");
    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty("source");
    expect(response.json()).not.toHaveProperty("related_project");
  });

  it("reads editorial changes consistently in list/detail without changing published bytes", async () => {
    const versions = () => db.prepare("SELECT * FROM plugin_versions ORDER BY id").all();
    const before = versions();
    const metadata = { source: { kind: "internal" as const }, related_project: {
      kind: "open-source" as const, name: "Catalog fixture", repository_url: REPOSITORY, license: "MIT",
    } };
    setPluginProvenance(db, tenantId(db, "investimentos"), "investimentos-base", metadata);
    const detail = await get("/v1/plugins/investimentos-base");
    expect(detail.json()).toMatchObject(metadata);
    const list = (await get("/v1/marketplace?q=investimentos-base")).json();
    expect(list.items).toEqual([detail.json()]);
    expect(versions()).toEqual(before);
    expect(() => setPluginProvenance(db, tenantId(db, "cartoes"), "investimentos-base", {})).toThrow("not found");
    expect((await get("/v1/plugins/investimentos-base")).json()).toEqual(detail.json());
  });

  it.each([
    "javascript:alert(1)", "http://github.com/example/demo", "https://user:secret@github.com/example/demo",
    "https://github.com.evil.test/example/demo", "https://github.com:443/example/demo",
    "https://github.com/example/demo?token=secret", "https://github.com/example/demo#fragment",
    "https://github.com/example/%2e%2e", "https://github.com/example/..",
  ])("rejects unsafe metadata writes and omits an unsafe stored link: %s", async (repository_url) => {
    const metadata = { source: { kind: "internal" as const, repository_url }, related_project: {
      kind: "open-source" as const, name: "Untrusted link", repository_url,
    } };
    expect(() => setPluginProvenance(db, tenantId(db, "investimentos"), "investimentos-base", metadata)).toThrow("Invalid catalog provenance");
    db.prepare("UPDATE plugins SET catalog_metadata = ? WHERE name = ?").run(JSON.stringify(metadata), "investimentos-base");
    const response = await get("/v1/plugins/investimentos-base");
    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty("source");
    expect(response.json()).not.toHaveProperty("related_project");
  });
});
