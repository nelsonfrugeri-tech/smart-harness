import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../../src/db/database.ts";
import { FakeHarness, FakeS3, login, marketplaceFixture, testServer } from "../../test-support.ts";
import {
  ADMIN,
  addSecondAdmin,
  addSecondDev,
  bearer,
  CARTOES_DEV,
  DEV,
  packageFiles,
  SECOND_ADMIN,
  SECOND_DEV,
  submittedContribution,
} from "./draft-helpers.ts";

describe("contributions", () => {
  let db: Db;
  let s3: FakeS3;
  let harness: FakeHarness;
  let app: FastifyInstance;
  let dev: string;
  let admin: string;

  beforeEach(async () => {
    const fixture = await marketplaceFixture();
    db = fixture.db;
    s3 = fixture.s3;
    addSecondDev(db);
    addSecondAdmin(db);
    harness = new FakeHarness();
    app = testServer(db, "local", fixture.storage, undefined, harness);
    dev = await login(app, DEV);
    admin = await login(app, ADMIN);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const versionCount = () => count("SELECT count(*) AS n FROM plugin_versions");
  const approvedAudits = () => count("SELECT count(*) AS n FROM audit_events WHERE action = 'contribution.approved'");

  async function approve(token: string, id: string, digest: string, comment?: string) {
    return app.inject({
      method: "POST",
      url: `/v1/contributions/${id}/approve`,
      headers: bearer(token),
      payload: { digest, ...(comment === undefined ? {} : { comment }) },
    });
  }

  async function state(id: string): Promise<string> {
    return (await app.inject({ method: "GET", url: `/v1/contributions/${id}`, headers: bearer(admin) })).json().state;
  }

  it("an ADMIN who is not the author publishes the digest they approved", async () => {
    const { contributionId, digest } = await submittedContribution(app, dev);
    const callsBefore = harness.calls.length;
    const s3Before = s3.sent.length;

    const response = await approve(admin, contributionId, digest, "looks good");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: contributionId,
      state: "published",
      digest,
      reviewer: { email: ADMIN },
      review_comment: "looks good",
    });
    expect(response.json().reviewed_at).toEqual(expect.any(String));
    // Approving is database work only: no binary, no object storage.
    expect(harness.calls.length).toBe(callsBefore);
    expect(s3.sent.length).toBe(s3Before);

    const versions = await app.inject({ method: "GET", url: "/v1/plugins/demo-contrib/versions", headers: bearer(dev) });
    expect(versions.statusCode).toBe(200);
    expect(versions.json().items).toEqual([
      expect.objectContaining({ version: "1.0.0", digest, visibility: "squad", description: "demo-contrib contribution." }),
    ]);
    const plugin = await app.inject({ method: "GET", url: "/v1/plugins/demo-contrib", headers: bearer(dev) });
    expect(plugin.json().components).toEqual([{ kind: "skill", name: "demo-skill", description: "From the report." }]);
    // The published archive is the one stored at validation, served by digest.
    const archive = await app.inject({
      method: "GET",
      url: "/v1/plugins/demo-contrib/versions/1.0.0/archive",
      headers: bearer(dev),
    });
    expect(archive.statusCode).toBe(200);
    expect(archive.headers["x-package-digest"]).toBe(digest);
    expect(approvedAudits()).toBe(1);
  });

  it("publishes the keywords of plugin.json through validate, submit and approve", async () => {
    const files = [
      {
        path: "plugin.json",
        content: JSON.stringify({ name: "tagged-contrib", version: "1.0.0", description: "Tagged.", keywords: ["go", "http"] }),
      },
      { path: "skills/demo-skill/SKILL.md", content: "body" },
    ];
    const { contributionId, digest } = await submittedContribution(app, dev, files);
    const submitted = await app.inject({ method: "GET", url: `/v1/contributions/${contributionId}`, headers: bearer(admin) });
    expect(submitted.json().plugin.keywords).toEqual(["go", "http"]);

    expect((await approve(admin, contributionId, digest)).statusCode).toBe(200);

    const plugin = await app.inject({ method: "GET", url: "/v1/plugins/tagged-contrib", headers: bearer(dev) });
    expect(plugin.statusCode).toBe(200);
    expect(plugin.json()).toMatchObject({ keywords: ["go", "http"], type: "skill", plugin: { description: "Tagged." } });
    const search = await app.inject({ method: "GET", url: "/v1/marketplace?q=http", headers: bearer(dev) });
    expect(search.json().items.map((item: { plugin: { name: string } }) => item.plugin.name)).toContain("tagged-contrib");
  });

  it("publishes the description and keywords of the validation report, not only plugin.json", async () => {
    const validate = harness.validate.bind(harness);
    harness.validate = async (dir) => ({
      ...(await validate(dir)),
      description: "Validated contribution metadata",
      keywords: ["metadata-tag"],
    });
    const { contributionId, digest } = await submittedContribution(app, dev);
    expect((await approve(admin, contributionId, digest)).statusCode).toBe(200);

    const plugin = await app.inject({ method: "GET", url: "/v1/plugins/demo-contrib", headers: bearer(dev) });
    expect(plugin.json()).toMatchObject({
      type: "skill",
      keywords: ["metadata-tag"],
      plugin: { description: "Validated contribution metadata" },
    });
    const search = await app.inject({ method: "GET", url: "/v1/marketplace?type=skill&q=metadata-tag", headers: bearer(dev) });
    expect(search.json().items.map((item: { plugin: { name: string } }) => item.plugin.name)).toEqual(["demo-contrib"]);
  });

  it("the author cannot approve their own contribution, even as ADMIN (403 self_approval)", async () => {
    const { contributionId, digest } = await submittedContribution(app, admin);
    const versionsBefore = versionCount();

    const response = await approve(admin, contributionId, digest);

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("self_approval");
    expect(versionCount()).toBe(versionsBefore);
    expect(await state(contributionId)).toBe("submitted");

    const byOtherAdmin = await approve(await login(app, SECOND_ADMIN), contributionId, digest);
    expect(byOtherAdmin.statusCode).toBe(200);
  });

  it("the database refuses a reviewer equal to the author", async () => {
    const { contributionId } = await submittedContribution(app, dev);
    const authorId = (db.prepare("SELECT author_id AS id FROM contributions WHERE id = ?").get(contributionId) as { id: string }).id;

    expect(() =>
      db.prepare("UPDATE contributions SET reviewer_id = ? WHERE id = ?").run(authorId, contributionId),
    ).toThrow(/CHECK constraint failed/);
  });

  it("a DEV of the squad gets 403 forbidden; a user of another squad gets 404", async () => {
    const { contributionId, digest } = await submittedContribution(app, dev);

    const byDev = await approve(await login(app, SECOND_DEV), contributionId, digest);
    expect(byDev.statusCode).toBe(403);
    expect(byDev.json().code).toBe("forbidden");

    const byOutsider = await approve(await login(app, CARTOES_DEV), contributionId, digest);
    expect(byOutsider.statusCode).toBe(404);
    expect(await state(contributionId)).toBe("submitted");
  });

  it("a digest other than the submitted one answers 409 digest_mismatch with no effect", async () => {
    const { contributionId } = await submittedContribution(app, dev);
    const versionsBefore = versionCount();

    const response = await approve(admin, contributionId, `sha256:${"0".repeat(64)}`);

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("digest_mismatch");
    expect(versionCount()).toBe(versionsBefore);
    expect(count("SELECT count(*) AS n FROM plugins WHERE name = 'demo-contrib'")).toBe(0);
    expect(approvedAudits()).toBe(0);
    expect(await state(contributionId)).toBe("submitted");
  });

  it("an edit after submit invalidates the approval: 409 contribution_not_submitted", async () => {
    const { draftId, contributionId, digest } = await submittedContribution(app, dev);
    const edit = await app.inject({
      method: "PATCH",
      url: `/v1/drafts/${draftId}`,
      headers: { ...bearer(dev), "if-match": '"1"' },
      payload: { files: packageFiles("demo-contrib", "1.0.0", [{ path: "README.md", content: "changed" }]) },
    });
    expect(edit.statusCode).toBe(200);

    const response = await approve(admin, contributionId, digest);

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("contribution_not_submitted");
    expect(count("SELECT count(*) AS n FROM plugins WHERE name = 'demo-contrib'")).toBe(0);
  });

  it("a failure after the version insert rolls the whole approval back", async () => {
    const { contributionId, digest } = await submittedContribution(app, dev);
    const versionsBefore = versionCount();
    // Fails the last write of the approval (the audit event), after the version, its components
    // and the contribution update.
    db.exec(`CREATE TRIGGER fail_approval BEFORE INSERT ON audit_events WHEN NEW.action = 'contribution.approved'
             BEGIN SELECT RAISE(ABORT, 'forced failure'); END`);

    const failed = await approve(admin, contributionId, digest);

    expect(failed.statusCode).toBe(500);
    expect(versionCount()).toBe(versionsBefore);
    expect(count("SELECT count(*) AS n FROM plugins WHERE name = 'demo-contrib'")).toBe(0);
    expect(count("SELECT count(*) AS n FROM components WHERE name = 'demo-skill'")).toBe(0);
    expect(await state(contributionId)).toBe("submitted");

    db.exec("DROP TRIGGER fail_approval");
    expect((await approve(admin, contributionId, digest)).statusCode).toBe(200);
    expect(versionCount()).toBe(versionsBefore + 1);
  });

  it("a second approval answers 409 contribution_not_submitted", async () => {
    const { contributionId, digest } = await submittedContribution(app, dev);
    expect((await approve(admin, contributionId, digest)).statusCode).toBe(200);

    const again = await approve(await login(app, SECOND_ADMIN), contributionId, digest);

    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("contribution_not_submitted");
    expect(approvedAudits()).toBe(1);
  });

  it("an existing version with another digest answers 409 version_exists", async () => {
    const { contributionId, digest } = await submittedContribution(app, dev, packageFiles("investimentos-base", "1.0.0"));
    const versionsBefore = versionCount();

    const response = await approve(admin, contributionId, digest);

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("version_exists");
    expect(versionCount()).toBe(versionsBefore);
  });

  it("a plugin of another squad answers 409 plugin_owned_by_other_squad", async () => {
    const { contributionId, digest } = await submittedContribution(app, dev, packageFiles("code-review", "9.0.0"));

    const response = await approve(admin, contributionId, digest);

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("plugin_owned_by_other_squad");
    expect(await state(contributionId)).toBe("submitted");
  });

  describe("reads", () => {
    it("?view=review lists submitted contributions of other authors where the caller is ADMIN", async () => {
      const { contributionId } = await submittedContribution(app, dev);
      await submittedContribution(app, admin, packageFiles("admin-own", "1.0.0"));

      const review = await app.inject({ method: "GET", url: "/v1/contributions?view=review", headers: bearer(admin) });
      expect(review.statusCode).toBe(200);
      expect(review.json().items.map((item: { id: string }) => item.id)).toEqual([contributionId]);

      const devReview = await app.inject({ method: "GET", url: "/v1/contributions?view=review", headers: bearer(dev) });
      expect(devReview.json()).toEqual({ items: [], next_cursor: null });

      const mine = await app.inject({ method: "GET", url: "/v1/contributions", headers: bearer(dev) });
      expect(mine.json().items.map((item: { id: string }) => item.id)).toEqual([contributionId]);
    });

    it("the author and ADMINs of the squad read a contribution; others get 404", async () => {
      const { contributionId } = await submittedContribution(app, dev);
      const get = async (token: string) =>
        app.inject({ method: "GET", url: `/v1/contributions/${contributionId}`, headers: bearer(token) });

      expect((await get(dev)).statusCode).toBe(200);
      expect((await get(admin)).statusCode).toBe(200);
      expect((await get(await login(app, SECOND_DEV))).statusCode).toBe(404);
      expect((await get(await login(app, CARTOES_DEV))).statusCode).toBe(404);
    });
  });
});
