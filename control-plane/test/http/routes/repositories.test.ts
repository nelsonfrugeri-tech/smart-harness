import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Db } from "../../../src/db/database.ts";
import { buildServer } from "../../../src/http/server.ts";
import { digestOf, type PackageManifest } from "../../../src/domain/marketplace.ts";
import { RepositoryError, type ReleasePackage } from "../../../src/domain/repositories.ts";
import { createPackageStorage } from "../../../src/storage/packages.ts";
import { FakeHarness, FakeS3, login, seededDatabase, tenantId, TEST_BUCKET, TEST_SECRET } from "../../test-support.ts";
import { addSecondAdmin } from "./draft-helpers.ts";

const manifest: PackageManifest = { name: "agent-demo", version: "1.0.0", description: "Project onboarding", components: [
  { kind: "agent", name: "guide", description: "Guide" },
  ...["github", "notion", "trello", "graphify", "deja-vu"].map((name) => ({ kind: "mcp" as const, name, description: "" })),
] };

describe("GitHub repository publication", () => {
  let db: Db;
  let app: FastifyInstance;
  let s3: FakeS3;
  let release: ReleasePackage;
  const readRelease = vi.fn();
  const downloadAsset = vi.fn();
  const inspectPackage = vi.fn();
  let admin: { authorization: string };
  beforeEach(async () => {
    db = seededDatabase();
    s3 = new FakeS3([TEST_BUCKET]);
    const archive = Buffer.from("test release bytes");
    release = { tag: "v1.0.0", commitSha: "a".repeat(40), releaseId: 11, assetId: 22, assetName: "agent-demo-1.0.0.tar.gz", archive, digest: digestOf(archive) };
    readRelease.mockReset().mockImplementation(async () => release);
    downloadAsset.mockReset().mockImplementation(async () => release.archive);
    inspectPackage.mockReset().mockResolvedValue(manifest);
    app = buildServer({ db, storage: createPackageStorage(s3, TEST_BUCKET), harness: new FakeHarness(),
      github: { readRelease, downloadAsset }, inspectPackage,
      config: { appEnv: "local", jwtSecret: TEST_SECRET, tokenTtlSeconds: 3600, logLevel: "silent", gatewayPublicUrl: "http://127.0.0.1:8081", gatewayTokenTtlDays: 90 } });
    admin = { authorization: `Bearer ${await login(app, "admin@smart-harness.local")}` };
  });
  afterEach(async () => { await app.close(); db.close(); });
  const registration = (scope: string, extra = {}) => ({ owner: "example", repo: "agent-demo", tenant_id: scope, visibility: "squad", ...extra });
  async function register(extra = {}) {
    const response = await app.inject({ method: "POST", url: "/v1/repositories", headers: admin,
      payload: registration(tenantId(db, "investimentos"), extra) });
    expect(response.statusCode).toBe(201);
    return response.json();
  }
  function sync(id: string, headers = admin) {
    return app.inject({ method: "POST", url: `/v1/repositories/${id}/sync`, headers, payload: { tag: "v1.0.0" } });
  }

  it("registers, publishes all five MCPs, lists provenance and downloads the exact pinned asset without S3", async () => {
    const repository = await register();
    expect(repository).toMatchObject({ owner: "example", repo: "agent-demo", last_sync: null });
    const published = await sync(repository.id);
    expect(published.statusCode).toBe(200);
    expect(published.json()).toMatchObject({ status: "created", plugin: "agent-demo", digest: release.digest, commit_sha: release.commitSha });
    const list = await app.inject({ url: "/v1/repositories", headers: admin });
    expect(list.json()).toMatchObject({ items: [{ id: repository.id, last_sync: { plugin: "agent-demo", tag: "v1.0.0" } }], next_cursor: null });
    const plugin = await app.inject({ url: "/v1/plugins/agent-demo", headers: admin });
    expect(plugin.json()).toMatchObject({ type: "agent", components: [...manifest.components].sort((a, b) => `${a.kind}/${a.name}`.localeCompare(`${b.kind}/${b.name}`)),
      source: { kind: "internal", repository_url: "https://github.com/example/agent-demo" } });
    const downloaded = await app.inject({ url: plugin.json().version.archive_url, headers: admin });
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.rawPayload).toEqual(release.archive);
    expect(downloaded.headers["x-package-digest"]).toBe(release.digest);
    expect(downloadAsset).toHaveBeenCalledWith(expect.objectContaining({ owner: "example", repo: "agent-demo", assetId: 22 }), 22);
    expect(s3.sent).toEqual([]);
    expect(db.prepare("SELECT tag, commit_sha, release_id, asset_id FROM github_package_versions").get()).toEqual({ tag: "v1.0.0", commit_sha: release.commitSha, release_id: 11, asset_id: 22 });
  });

  it("rejects DEV writes, out-of-scope repositories and unauthenticated reads before upstream access", async () => {
    const repository = await register();
    const dev = { authorization: `Bearer ${await login(app, "dev@smart-harness.local")}` };
    const other = { authorization: `Bearer ${await login(app, "dev.cartoes@smart-harness.local")}` };
    expect((await app.inject({ url: "/v1/repositories" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/repositories", headers: dev, payload: registration(tenantId(db, "investimentos")) })).statusCode).toBe(403);
    expect((await sync(repository.id, dev)).statusCode).toBe(403);
    expect((await sync(repository.id, other)).statusCode).toBe(404);
    expect((await app.inject({ url: "/v1/repositories", headers: other })).json()).toEqual({ items: [], next_cursor: null });
    expect(readRelease).not.toHaveBeenCalled();
    await sync(repository.id);
    expect((await app.inject({ url: "/v1/plugins/agent-demo/versions/1.0.0/archive", headers: other })).statusCode).toBe(404);
    expect(downloadAsset).not.toHaveBeenCalled();
  });

  it("does not allow a gateway token to administer repositories", async () => {
    const created = await app.inject({ method: "POST", url: "/v1/me/gateway-tokens", headers: admin, payload: { name: "cli" } });
    const headers = { authorization: `Bearer ${created.json().token}` };
    expect((await app.inject({ url: "/v1/repositories", headers })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/repositories", headers, payload: {} })).statusCode).toBe(401);
  });

  it("handles duplicate registration, normalizes case and refuses changes to ownership or visibility", async () => {
    const repository = await register();
    const repeated = await app.inject({ method: "POST", url: "/v1/repositories", headers: admin,
      payload: registration(tenantId(db, "investimentos"), { owner: "EXAMPLE", repo: "AGENT-DEMO" }) });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().id).toBe(repository.id);
    for (const extra of [{ visibility: "organization" }, { tenant_id: tenantId(db, "cartoes") }]) {
      expect((await app.inject({ method: "POST", url: "/v1/repositories", headers: admin,
        payload: registration(tenantId(db, "investimentos"), extra) })).statusCode).toBe(409);
    }
  });

  it("paginates registrations without duplicating or omitting repositories", async () => {
    await register();
    await register({ repo: "another-agent" });
    const first = (await app.inject({ url: "/v1/repositories?limit=1", headers: admin })).json();
    const second = (await app.inject({ url: `/v1/repositories?limit=1&cursor=${first.next_cursor}`, headers: admin })).json();
    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(1);
    expect(second.items[0].id).not.toBe(first.items[0].id);
    expect(second.next_cursor).toBeNull();
  });

  it("makes identical sync idempotent and refuses a changed digest without altering published bytes", async () => {
    const repository = await register();
    await sync(repository.id);
    expect((await sync(repository.id)).json().status).toBe("unchanged");
    release = { ...release, archive: Buffer.from("changed archive"), digest: digestOf(Buffer.from("changed archive")) };
    const conflict = await sync(repository.id);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe("version_exists");
    expect(db.prepare("SELECT count(*) AS n FROM plugin_versions").get()).toEqual({ n: 1 });
    expect((await app.inject({ url: "/v1/plugins/agent-demo/versions/1.0.0/archive", headers: admin })).statusCode).toBe(502);
    expect(s3.sent).toEqual([]);
  });

  it.each(["commitSha", "assetId", "releaseId"] as const)("refuses mutated %s even when the archive has the same digest", async (field) => {
    const repository = await register();
    await sync(repository.id);
    release = { ...release, [field]: field === "commitSha" ? "b".repeat(40) : 999 };
    const changed = await sync(repository.id);
    expect(changed.statusCode).toBe(409);
    expect(changed.json().code).toBe("release_changed");
  });

  it.each(["digest", "archive", "manifest", "version"])("rejects invalid %s without publishing partial state", async (invalid) => {
    const repository = await register();
    if (invalid === "digest") release.digest = `sha256:${"b".repeat(64)}`;
    if (invalid === "archive") release.archive = new Uint8Array();
    if (invalid === "manifest") inspectPackage.mockRejectedValue(new RepositoryError(422, "invalid_archive", "invalid"));
    if (invalid === "version") inspectPackage.mockResolvedValue({ ...manifest, version: "2.0.0" });
    expect((await sync(repository.id)).statusCode).toBe(422);
    expect(db.prepare("SELECT count(*) AS n FROM plugin_versions").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT last_synced_at FROM github_repositories").get()).toEqual({ last_synced_at: null });
    expect(s3.sent).toEqual([]);
  });

  it("rechecks ADMIN permission after downloading and validating the release", async () => {
    const repository = await register();
    inspectPackage.mockImplementation(async () => {
      db.prepare("DELETE FROM memberships WHERE tenant_id = ?").run(tenantId(db, "investimentos"));
      return manifest;
    });
    expect((await sync(repository.id)).statusCode).toBe(403);
    expect(db.prepare("SELECT count(*) AS n FROM plugin_versions").get()).toEqual({ n: 0 });
  });

  it("reports a deleted or unavailable pinned asset as an upstream failure", async () => {
    const repository = await register();
    await sync(repository.id);
    downloadAsset.mockRejectedValue(new RepositoryError(422, "github_not_found", "missing asset"));
    const response = await app.inject({ url: "/v1/plugins/agent-demo/versions/1.0.0/archive", headers: admin });
    expect(response.statusCode).toBe(502);
    expect(response.json().code).toBe("github_unavailable");
    expect(s3.sent).toEqual([]);
  });

  it("does not allow another squad to overwrite a plugin's ownership", async () => {
    const repository = await register();
    await sync(repository.id);
    const other = await register({ repo: "other-source", tenant_id: tenantId(db, "cartoes") });
    const conflict = await sync(other.id);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe("plugin_owned_by_other_squad");
  });

  it("keeps organization visibility available to members while repository settings remain scoped", async () => {
    const repository = await register({ tenant_id: tenantId(db, "cartoes"), visibility: "organization" });
    await sync(repository.id);
    addSecondAdmin(db);
    const other = { authorization: `Bearer ${await login(app, "admin2@smart-harness.local")}` };
    expect((await app.inject({ url: "/v1/plugins/agent-demo/versions/1.0.0/archive", headers: other })).statusCode).toBe(200);
    expect((await app.inject({ url: "/v1/repositories", headers: other })).json().items).toEqual([]);
  });
});
