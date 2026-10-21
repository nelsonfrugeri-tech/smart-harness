import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PACKAGES_DIR } from "../../../seed/marketplace.ts";
import type { Db } from "../../../src/db/database.ts";
import { upsertUser } from "../../../src/db/repos/seed.ts";
import { login, marketplaceFixture, testServer, type FakeS3 } from "../../test-support.ts";

const DEV = "dev@smart-harness.local"; // DEV in investimentos and conta
const DEV_CARTOES = "dev.cartoes@smart-harness.local";
const OUTSIDER = "outsider@smart-harness.local"; // no membership

interface Item {
  plugin: { name: string; tenant: { slug: string } };
  version: { version: string; visibility: string; digest: string };
  components: { kind: string; name: string }[];
}

describe("Marketplace routes", () => {
  let db: Db;
  let s3: FakeS3;
  let app: FastifyInstance;

  beforeEach(async () => {
    const fixture = await marketplaceFixture();
    db = fixture.db;
    s3 = fixture.s3;
    upsertUser(db, { email: OUTSIDER, name: "Outsider" });
    app = testServer(db, "local", fixture.storage);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  async function get(email: string, url: string) {
    const token = await login(app, email);
    return app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
  }

  async function names(email: string, url: string): Promise<string[]> {
    const response = await get(email, url);
    expect(response.statusCode).toBe(200);
    return response.json<{ items: Item[] }>().items.map((item) => item.plugin.name);
  }

  describe("visibility between squads", () => {
    it("a DEV sees the plugins of their squads and the organization ones, never another squad's", async () => {
      expect(await names(DEV, "/v1/marketplace")).toEqual(["code-review", "conta-base", "investimentos-base"]);
      expect(await names(DEV_CARTOES, "/v1/marketplace")).toEqual(["cartoes-base", "code-review"]);
    });

    it("a squad plugin of another squad answers 404 on detail, versions and archive, like a missing one", async () => {
      const hidden = [
        "/v1/plugins/cartoes-base",
        "/v1/plugins/cartoes-base/versions",
        "/v1/plugins/cartoes-base/versions/1.0.0/archive",
      ];
      for (const url of hidden) {
        const response = await get(DEV, url);
        expect(response.statusCode, url).toBe(404);
        expect(response.json(), url).toMatchObject({ code: "not_found" });
      }
      const missing = await get(DEV, "/v1/plugins/does-not-exist");
      expect(missing.statusCode).toBe(404);
      expect(missing.json().detail).toBe((await get(DEV, "/v1/plugins/cartoes-base")).json().detail);
    });

    it("an organization plugin owned by another squad is visible and downloadable", async () => {
      const detail = await get(DEV, "/v1/plugins/code-review");
      expect(detail.statusCode).toBe(200);
      expect(detail.json<Item>()).toMatchObject({
        plugin: { name: "code-review", tenant: { slug: "cartoes" } },
        version: { version: "1.0.0", visibility: "organization" },
      });
      expect((await get(DEV, "/v1/plugins/code-review/versions/1.0.0/archive")).statusCode).toBe(200);
    });

    it("a user without memberships sees nothing, not even organization plugins", async () => {
      expect(await names(OUTSIDER, "/v1/marketplace")).toEqual([]);
      for (const url of [
        "/v1/plugins/code-review",
        "/v1/plugins/code-review/versions",
        "/v1/plugins/code-review/versions/1.0.0/archive",
        "/v1/marketplace?project=investimentos-api",
      ]) {
        expect((await get(OUTSIDER, url)).statusCode, url).toBe(404);
      }
    });

    it("every route requires a token", async () => {
      for (const url of ["/v1/marketplace", "/v1/plugins/code-review", "/v1/plugins/code-review/versions/1.0.0/archive"]) {
        const response = await app.inject({ method: "GET", url });
        expect(response.statusCode, url).toBe(401);
      }
    });
  });

  describe("GET /v1/marketplace filters", () => {
    it("kind keeps plugins whose latest version ships that kind", async () => {
      expect(await names(DEV, "/v1/marketplace?kind=mcp")).toEqual(["conta-base", "investimentos-base"]);
      expect(await names(DEV, "/v1/marketplace?kind=skill")).toEqual(["code-review", "conta-base", "investimentos-base"]);
    });

    it("q matches plugin and component names as a plain substring", async () => {
      expect(await names(DEV, "/v1/marketplace?q=ORDER-review")).toEqual(["investimentos-base"]);
      expect(await names(DEV, "/v1/marketplace?q=%25")).toEqual([]);
      expect(await names(DEV, "/v1/marketplace?q=_")).toEqual([]);
    });

    it("project lists the optionals of that project's squad and hides the baseline", async () => {
      expect(await names(DEV, "/v1/marketplace?project=investimentos-api")).toEqual(["code-review"]);
      expect((await get(DEV, "/v1/marketplace?project=cartoes-app")).statusCode).toBe(404);
    });

    it("rejects an unknown kind and an out-of-range limit", async () => {
      for (const url of ["/v1/marketplace?kind=hook", "/v1/marketplace?limit=0", "/v1/marketplace?limit=101"]) {
        const response = await get(DEV, url);
        expect(response.statusCode, url).toBe(400);
        expect(response.json().code, url).toBe("validation_failed");
      }
    });
  });

  describe("pagination", () => {
    it("walks every plugin once with limit=1 and ends with next_cursor null", async () => {
      const token = await login(app, DEV);
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const query: string = cursor === null ? "" : `&cursor=${cursor}`;
        const response = await app.inject({
          method: "GET",
          url: `/v1/marketplace?limit=1${query}`,
          headers: { authorization: `Bearer ${token}` },
        });
        const page = response.json<{ items: Item[]; next_cursor: string | null }>();
        expect(page.items.length).toBeLessThanOrEqual(1);
        seen.push(...page.items.map((item) => item.plugin.name));
        cursor = page.next_cursor;
      } while (cursor !== null);

      expect(seen).toEqual(["code-review", "conta-base", "investimentos-base"]);
    });

    it("an invalid cursor answers 400 invalid_cursor", async () => {
      for (const cursor of ["not-base64-json", Buffer.from('{"k":12}').toString("base64url")]) {
        const response = await get(DEV, `/v1/marketplace?cursor=${cursor}`);
        expect(response.statusCode).toBe(400);
        expect(response.json().code).toBe("invalid_cursor");
      }
    });

    it("lists versions newest first, one per page", async () => {
      const first = (await get(DEV, "/v1/plugins/investimentos-base/versions?limit=1")).json();
      expect(first.items.map((v: { version: string }) => v.version)).toEqual(["1.1.0"]);
      const second = (await get(DEV, `/v1/plugins/investimentos-base/versions?limit=1&cursor=${first.next_cursor}`)).json();
      expect(second).toMatchObject({ items: [{ version: "1.0.0" }], next_cursor: null });
    });
  });

  it("GET /v1/plugins/{name} returns the latest version with its components", async () => {
    const body = (await get(DEV, "/v1/plugins/investimentos-base")).json<Item>();

    expect(body.version.version).toBe("1.1.0");
    expect(body.components.map((c) => `${c.kind}:${c.name}`)).toEqual([
      "agent:investimentos-assistant",
      "mcp:github",
      "skill:investimentos-conventions",
      "skill:order-review",
    ]);
  });

  describe("archive download", () => {
    it("returns the stored tar.gz; its sha256 matches the digest header and the published file", async () => {
      const response = await get(DEV, "/v1/plugins/investimentos-base/versions/1.1.0/archive");

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toBe("application/gzip");
      const sha = `sha256:${createHash("sha256").update(response.rawPayload).digest("hex")}`;
      expect(response.headers["x-package-digest"]).toBe(sha);
      expect(response.rawPayload.equals(readFileSync(`${PACKAGES_DIR}investimentos-base-1.1.0.tar.gz`))).toBe(true);
    });

    it("an unknown version answers 404; a malformed one answers 400", async () => {
      expect((await get(DEV, "/v1/plugins/investimentos-base/versions/9.9.9/archive")).statusCode).toBe(404);
      expect((await get(DEV, "/v1/plugins/investimentos-base/versions/latest/archive")).statusCode).toBe(400);
    });

    it("fails with 500, not a corrupt file, when the stored object no longer matches its digest", async () => {
      const { digest } = (await get(DEV, "/v1/plugins/code-review")).json<Item>().version;
      s3.objects.set(`packages/packages/sha256-${digest.slice("sha256:".length)}.tar.gz`, new Uint8Array([1, 2, 3]));

      const response = await get(DEV, "/v1/plugins/code-review/versions/1.0.0/archive");
      expect(response.statusCode).toBe(500);
      expect(response.json().code).toBe("internal_error");
    });
  });
});
