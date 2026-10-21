import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../../src/db/database.ts";
import { MAX_DRAFT_FILE_BYTES } from "../../../src/domain/drafts.ts";
import { FakeHarness, FakeS3, login, marketplaceFixture, TEST_BUCKET, testServer } from "../../test-support.ts";
import {
  ADMIN,
  addSecondDev,
  bearer,
  CARTOES_DEV,
  createDraft,
  DEV,
  packageFiles,
  SECOND_DEV,
  submitDraft,
  validateDraft,
} from "./draft-helpers.ts";

const sha256 = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

describe("drafts", () => {
  let db: Db;
  let s3: FakeS3;
  let harness: FakeHarness;
  let app: FastifyInstance;
  let dev: string;

  beforeEach(async () => {
    const fixture = await marketplaceFixture();
    db = fixture.db;
    s3 = fixture.s3;
    addSecondDev(db);
    harness = new FakeHarness();
    app = testServer(db, "local", fixture.storage, undefined, harness);
    dev = await login(app, DEV);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  const draftCount = () => (db.prepare("SELECT count(*) AS n FROM drafts").get() as { n: number }).n;

  async function patch(token: string, id: string, payload: object, ifMatch?: string) {
    return app.inject({
      method: "PATCH",
      url: `/v1/drafts/${id}`,
      headers: { ...bearer(token), ...(ifMatch === undefined ? {} : { "if-match": ifMatch }) },
      payload,
    });
  }

  describe("create and read", () => {
    it("POST /v1/drafts creates a squad draft at revision 1 with an ETag", async () => {
      const response = await createDraft(app, dev);

      expect(response.statusCode).toBe(201);
      expect(response.headers.etag).toBe('"1"');
      expect(response.json()).toMatchObject({
        tenant: { slug: "investimentos" },
        author: { email: DEV },
        visibility: "squad",
        revision: 1,
        file_count: 2,
        validation: null,
        files: packageFiles(),
      });
    });

    it("a tenant the author does not belong to answers 404 and creates nothing", async () => {
      const response = await createDraft(app, dev, { tenant: "cartoes" });

      expect(response.statusCode).toBe(404);
      expect(draftCount()).toBe(0);
    });

    it.each([
      ["/tmp/outside.txt", "path must be relative"],
      ["../escape.txt", '".." segments'],
      ["skills/../../escape.txt", '".." segments'],
      ["skills/./x.md", '".." segments'],
      ["skills//x.md", '".." segments'],
      ["skills\\x.md", "backslash"],
      ["C:/x.md", "path must be relative"],
    ])("refuses the path %s with 400 invalid_path and stores nothing", async (path, reason) => {
      const response = await createDraft(app, dev, { files: packageFiles("demo-contrib", "1.0.0", [{ path, content: "x" }]) });

      expect(response.statusCode).toBe(400);
      expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
      const body = response.json();
      expect(body.code).toBe("invalid_path");
      expect(body.errors).toHaveLength(1);
      expect(body.errors[0].path).toBe("/files/2/path");
      expect(body.errors[0].message).toContain(reason);
      expect(draftCount()).toBe(0);
    });

    it("refuses repeated paths and a path below another file", async () => {
      const response = await createDraft(app, dev, {
        files: packageFiles("demo-contrib", "1.0.0", [
          { path: "plugin.json", content: "{}" },
          { path: "plugin.json/inner", content: "x" },
        ]),
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().errors.map((error: { path: string }) => error.path)).toEqual(["/files/2/path", "/files/3/path"]);
    });

    it("a file above the size limit answers 413 draft_too_large", async () => {
      const big = { path: "skills/demo-skill/big.md", content: "a".repeat(MAX_DRAFT_FILE_BYTES + 1) };
      const response = await createDraft(app, dev, { files: packageFiles("demo-contrib", "1.0.0", [big]) });

      expect(response.statusCode).toBe(413);
      expect(response.json().code).toBe("draft_too_large");
      expect(draftCount()).toBe(0);
    });

    it("before submit only the author reads a draft; an ADMIN of the squad and others get 404", async () => {
      const id = (await createDraft(app, dev)).json().id;
      const get = async (email: string) =>
        app.inject({ method: "GET", url: `/v1/drafts/${id}`, headers: bearer(await login(app, email)) });

      expect((await get(DEV)).statusCode).toBe(200);
      const byAdmin = await get(ADMIN);
      expect(byAdmin.statusCode).toBe(404);
      expect(byAdmin.json().code).toBe("not_found");
      expect(byAdmin.body).not.toContain("skills/demo-skill");
      expect((await get(SECOND_DEV)).statusCode).toBe(404);
      expect((await get(CARTOES_DEV)).statusCode).toBe(404);
    });

    it("GET /v1/drafts lists only the caller's drafts, newest first, with a cursor", async () => {
      const first = (await createDraft(app, dev)).json().id;
      const second = (await createDraft(app, dev)).json().id;
      await createDraft(app, await login(app, SECOND_DEV));
      // Two inserts can share a millisecond; the order is (created_at, id), so pin the times.
      db.prepare("UPDATE drafts SET created_at = ? WHERE id = ?").run("2026-01-01T00:00:00.000Z", first);
      db.prepare("UPDATE drafts SET created_at = ? WHERE id = ?").run("2026-01-02T00:00:00.000Z", second);

      const page1 = await app.inject({ method: "GET", url: "/v1/drafts?limit=1", headers: bearer(dev) });
      expect(page1.statusCode).toBe(200);
      expect(page1.json().items.map((item: { id: string }) => item.id)).toEqual([second]);
      expect(page1.json().items[0].files).toBeUndefined();

      const cursor = page1.json().next_cursor;
      const page2 = await app.inject({ method: "GET", url: `/v1/drafts?limit=1&cursor=${cursor}`, headers: bearer(dev) });
      expect(page2.json()).toMatchObject({ items: [{ id: first }], next_cursor: null });
    });
  });

  describe("PATCH", () => {
    it("requires If-Match (428), refuses a stale revision (412) and bumps the revision", async () => {
      const id = (await createDraft(app, dev)).json().id;
      const files = packageFiles("demo-contrib", "1.0.1");

      expect((await patch(dev, id, { files })).statusCode).toBe(428);
      expect((await patch(dev, id, { files })).json().code).toBe("if_match_required");
      const stale = await patch(dev, id, { files }, '"7"');
      expect(stale.statusCode).toBe(412);
      expect(stale.json().code).toBe("revision_mismatch");

      const updated = await patch(dev, id, { files, visibility: "organization" }, '"1"');
      expect(updated.statusCode).toBe(200);
      expect(updated.headers.etag).toBe('"2"');
      expect(updated.json()).toMatchObject({ revision: 2, visibility: "organization", files });
    });

    it("only the author edits: an ADMIN gets 404 before submit and 403 while reviewing", async () => {
      const id = (await createDraft(app, dev)).json().id;
      const adminToken = await login(app, ADMIN);
      expect((await patch(adminToken, id, { visibility: "organization" }, '"1"')).statusCode).toBe(404);

      await validateDraft(app, dev, id);
      await submitDraft(app, dev, id);
      const response = await patch(adminToken, id, { visibility: "organization" }, '"1"');

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe("forbidden");
    });

    it("refuses an unsafe path before storing anything", async () => {
      const id = (await createDraft(app, dev)).json().id;
      const response = await patch(dev, id, { files: [{ path: "../x", content: "x" }] }, '"1"');

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("invalid_path");
      const stored = await app.inject({ method: "GET", url: `/v1/drafts/${id}`, headers: bearer(dev) });
      expect(stored.json()).toMatchObject({ revision: 1, files: packageFiles() });
    });
  });

  describe("validate", () => {
    it("packs a valid draft, stores the archive under the pack digest and records the validation", async () => {
      const id = (await createDraft(app, dev)).json().id;

      const response = await validateDraft(app, dev, id);

      expect(response.statusCode).toBe(200);
      const { valid, digest, findings } = response.json();
      expect(valid).toBe(true);
      expect(findings).toEqual([]);
      expect(harness.calls).toEqual(["validate", "generate", "pack"]);
      const key = `${TEST_BUCKET}/packages/sha256-${digest.slice(7)}.tar.gz`;
      const stored = s3.objects.get(key);
      expect(stored).toBeDefined();
      expect(sha256(stored as Uint8Array)).toBe(digest);
      // The archive is what pack wrote after generate, so it carries the generated layer.
      expect(Buffer.from(stored as Uint8Array).toString()).toContain("GENERATED.md");

      const draft = (await app.inject({ method: "GET", url: `/v1/drafts/${id}`, headers: bearer(dev) })).json();
      expect(draft.validation).toMatchObject({
        revision: 1,
        digest,
        size_bytes: (stored as Uint8Array).byteLength,
        plugin: { name: "demo-contrib", version: "1.0.0", description: "demo-contrib contribution." },
        components: [{ kind: "skill", name: "demo-skill", description: "From the report." }],
      });
    });

    it("an invalid draft answers valid:false with the findings and stores nothing", async () => {
      const files = packageFiles("demo-contrib", "1.0.0", [{ path: "skills/demo-skill/bad.md", content: "INVALID" }]);
      const id = (await createDraft(app, dev, { files })).json().id;
      const objectsBefore = s3.objects.size;

      const response = await validateDraft(app, dev, id);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        valid: false,
        digest: null,
        findings: [
          {
            code: "SH-TEST-001",
            severity: "error",
            message: "file is invalid",
            hint: "remove INVALID",
            path: "skills/demo-skill/bad.md",
            line: 1,
          },
        ],
      });
      expect(harness.calls).toEqual(["validate"]);
      expect(s3.objects.size).toBe(objectsBefore);
    });

    it("an edit during validation wins: the old result answers 409 draft_changed and is not recorded", async () => {
      const id = (await createDraft(app, dev)).json().id;
      harness.onValidate = async () => {
        harness.onValidate = undefined;
        const edit = await patch(dev, id, { files: packageFiles("demo-contrib", "2.0.0") }, '"1"');
        expect(edit.statusCode).toBe(200);
      };

      const response = await validateDraft(app, dev, id);

      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe("draft_changed");
      const draft = (await app.inject({ method: "GET", url: `/v1/drafts/${id}`, headers: bearer(dev) })).json();
      expect(draft).toMatchObject({ revision: 2, validation: null });
    });

    it("an edit clears the validation", async () => {
      const id = (await createDraft(app, dev)).json().id;
      await validateDraft(app, dev, id);

      const edited = await patch(dev, id, { visibility: "organization" }, '"1"');

      expect(edited.json()).toMatchObject({ revision: 2, validation: null });
    });

    it("only the author validates", async () => {
      const id = (await createDraft(app, dev)).json().id;
      const response = await validateDraft(app, await login(app, ADMIN), id);

      expect(response.statusCode).toBe(404);
      expect(harness.calls).toEqual([]);
    });
  });

  describe("archive", () => {
    it("answers 409 draft_not_validated before a validation", async () => {
      const id = (await createDraft(app, dev)).json().id;
      const response = await app.inject({ method: "GET", url: `/v1/drafts/${id}/archive`, headers: bearer(dev) });

      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe("draft_not_validated");
    });

    it("serves the validated archive with its digest to the author, also with the gateway token", async () => {
      const id = (await createDraft(app, dev)).json().id;
      const { digest } = (await validateDraft(app, dev, id)).json();
      const shg = (
        await app.inject({ method: "POST", url: "/v1/me/gateway-tokens", headers: bearer(dev), payload: { name: "cli" } })
      ).json().token;

      for (const token of [dev, shg]) {
        const response = await app.inject({ method: "GET", url: `/v1/drafts/${id}/archive`, headers: bearer(token) });
        expect(response.statusCode).toBe(200);
        expect(response.headers["content-type"]).toBe("application/gzip");
        expect(response.headers["x-package-digest"]).toBe(digest);
        expect(sha256(response.rawPayload)).toBe(digest);
      }
      const other = await app.inject({
        method: "GET",
        url: `/v1/drafts/${id}/archive`,
        headers: bearer(await login(app, SECOND_DEV)),
      });
      expect(other.statusCode).toBe(404);
    });
  });

  describe("reviewer access to a draft", () => {
    // The approver's `harness draft pull` uses the gateway token on the archive.
    async function adminReads(id: string) {
      const adminJwt = await login(app, ADMIN);
      const adminShg = (
        await app.inject({ method: "POST", url: "/v1/me/gateway-tokens", headers: bearer(adminJwt), payload: { name: "cli" } })
      ).json().token;
      const detail = await app.inject({ method: "GET", url: `/v1/drafts/${id}`, headers: bearer(adminJwt) });
      const archive = await app.inject({ method: "GET", url: `/v1/drafts/${id}/archive`, headers: bearer(adminShg) });
      return { detail, archive };
    }

    it("before submit an ADMIN of the squad gets 404 on the detail and the archive", async () => {
      const id = (await createDraft(app, dev)).json().id;
      await validateDraft(app, dev, id);

      const { detail, archive } = await adminReads(id);

      expect(detail.statusCode).toBe(404);
      expect(archive.statusCode).toBe(404);
      expect(archive.json().code).toBe("not_found");
      expect(archive.headers["x-package-digest"]).toBeUndefined();
    });

    it("after submit an ADMIN reads the submitted revision and pulls its archive", async () => {
      const id = (await createDraft(app, dev)).json().id;
      const { digest } = (await validateDraft(app, dev, id)).json();
      await submitDraft(app, dev, id);

      const { detail, archive } = await adminReads(id);

      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toMatchObject({ revision: 1, files: packageFiles(), validation: { digest } });
      expect(archive.statusCode).toBe(200);
      expect(archive.headers["x-package-digest"]).toBe(digest);
      expect(sha256(archive.rawPayload)).toBe(digest);
      // A DEV of the squad never reviews, so the draft stays hidden from them.
      const byDev = await app.inject({ method: "GET", url: `/v1/drafts/${id}`, headers: bearer(await login(app, SECOND_DEV)) });
      expect(byDev.statusCode).toBe(404);
    });

    it("after an edit the new revision is private again until the next submit", async () => {
      const id = (await createDraft(app, dev)).json().id;
      await validateDraft(app, dev, id);
      await submitDraft(app, dev, id);
      const edited = await patch(dev, id, { files: packageFiles("demo-contrib", "1.1.0") }, '"1"');
      expect(edited.statusCode).toBe(200);

      const afterEdit = await adminReads(id);
      expect(afterEdit.detail.statusCode).toBe(404);
      expect(afterEdit.detail.body).not.toContain("1.1.0");
      expect(afterEdit.archive.statusCode).toBe(404);

      const { digest } = (await validateDraft(app, dev, id)).json();
      expect((await submitDraft(app, dev, id)).statusCode).toBe(201);
      const afterResubmit = await adminReads(id);
      expect(afterResubmit.detail.json()).toMatchObject({ revision: 2, validation: { digest } });
      expect(afterResubmit.archive.headers["x-package-digest"]).toBe(digest);
    });

    it("a submitted contribution of an older revision does not open the current one", async () => {
      const id = (await createDraft(app, dev)).json().id;
      await validateDraft(app, dev, id);
      await submitDraft(app, dev, id);
      // Simulates a stale submitted row: only the revision binding keeps the draft private.
      db.prepare("UPDATE drafts SET revision = revision + 1, validated_revision = NULL, validated_digest = NULL, validated_size_bytes = NULL, validated_manifest = NULL WHERE id = ?").run(id);

      const { detail, archive } = await adminReads(id);

      expect(detail.statusCode).toBe(404);
      expect(archive.statusCode).toBe(404);
    });
  });

  describe("submit", () => {
    it("needs a validation of the current revision, then creates one submitted contribution", async () => {
      const id = (await createDraft(app, dev)).json().id;
      expect((await submitDraft(app, dev, id)).json().code).toBe("draft_not_validated");

      const { digest } = (await validateDraft(app, dev, id)).json();
      const submitted = await submitDraft(app, dev, id);

      expect(submitted.statusCode).toBe(201);
      expect(submitted.json()).toMatchObject({
        draft_id: id,
        state: "submitted",
        revision: 1,
        digest,
        plugin: { name: "demo-contrib", version: "1.0.0" },
        author: { email: DEV },
        reviewer: null,
      });
      const again = await submitDraft(app, dev, id);
      expect(again.statusCode).toBe(409);
      expect(again.json().code).toBe("contribution_open");
    });

    it("an edit after submit invalidates the contribution in the same transaction", async () => {
      const id = (await createDraft(app, dev)).json().id;
      await validateDraft(app, dev, id);
      const contribution = (await submitDraft(app, dev, id)).json();

      expect((await patch(dev, id, { visibility: "organization" }, '"1"')).statusCode).toBe(200);

      const read = await app.inject({ method: "GET", url: `/v1/contributions/${contribution.id}`, headers: bearer(dev) });
      expect(read.json().state).toBe("invalidated");
      expect((await submitDraft(app, dev, id)).json().code).toBe("draft_not_validated");
    });
  });
});
