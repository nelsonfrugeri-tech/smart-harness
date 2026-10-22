import { randomUUID } from "node:crypto";
import type { Db } from "../database.ts";
import { isAdminOf, scopeTenantIdsJson, type Principal, type Scope } from "../../domain/access.ts";
import type { PackageManifest, Visibility } from "../../domain/marketplace.ts";
import { RepositoryError, repositoryUrl, type ReleasePackage } from "../../domain/repositories.ts";
import { insertPublishedVersion } from "./marketplace.ts";

export interface RepositoryRecord {
  id: string;
  owner: string;
  repo: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  visibility: Visibility;
  createdAt: string;
  lastSyncedAt: string | null;
  lastPlugin: string | null;
  lastVersion: string | null;
  lastTag: string | null;
  lastCommitSha: string | null;
  lastDigest: string | null;
}
const SELECT = `SELECT r.id, r.owner, r.repo, r.tenant_id AS tenantId, r.visibility,
  t.slug AS tenantSlug, t.name AS tenantName, r.created_at AS createdAt, r.last_synced_at AS lastSyncedAt,
  p.name AS lastPlugin, v.version AS lastVersion, v.digest AS lastDigest, g.tag AS lastTag, g.commit_sha AS lastCommitSha
  FROM github_repositories r JOIN tenants t ON t.id = r.tenant_id
  LEFT JOIN plugin_versions v ON v.id = r.last_version_id
  LEFT JOIN plugins p ON p.id = v.plugin_id
  LEFT JOIN github_package_versions g ON g.version_id = v.id`;

export function listRepositories(db: Db, scope: Scope, page: { afterId?: string; limit: number }): RepositoryRecord[] {
  return db.prepare(`${SELECT} WHERE r.tenant_id IN (SELECT value FROM json_each(@scope))
    AND (@after IS NULL OR r.id > @after) ORDER BY r.id LIMIT @limit`).all({
    scope: scopeTenantIdsJson(scope), after: page.afterId ?? null, limit: page.limit,
  }) as RepositoryRecord[];
}

export function findRepository(db: Db, scope: Scope, id: string): RepositoryRecord | undefined {
  return db.prepare(`${SELECT} WHERE r.id = @id AND r.tenant_id IN (SELECT value FROM json_each(@scope))`)
    .get({ id, scope: scopeTenantIdsJson(scope) }) as RepositoryRecord | undefined;
}

export function registerRepository(db: Db, principal: Principal, input: {
  owner: string; repo: string; tenantId: string; visibility: Visibility;
}): { created: boolean; repository: RepositoryRecord } {
  if (!isAdminOf(principal, input.tenantId)) throw new RepositoryError(403, "forbidden", "only a squad ADMIN can register repositories");
  const owner = input.owner.toLowerCase();
  const repo = input.repo.toLowerCase();
  return db.transaction(() => {
    const existing = db.prepare("SELECT id, tenant_id AS tenantId, visibility FROM github_repositories WHERE owner = ? AND repo = ?")
      .get(owner, repo) as { id: string; tenantId: string; visibility: Visibility } | undefined;
    if (existing && (existing.tenantId !== input.tenantId || existing.visibility !== input.visibility)) {
      throw new RepositoryError(409, "repository_exists", "repository is already registered with another owner or visibility");
    }
    const id = existing?.id ?? randomUUID();
    if (!existing) db.prepare("INSERT INTO github_repositories(id, tenant_id, owner, repo, visibility, created_by) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, input.tenantId, owner, repo, input.visibility, principal.user.id);
    const repository = findRepository(db, principal.scope, id);
    if (!repository) throw new Error("registered repository is not visible to its owner");
    return { created: existing === undefined, repository };
  }).immediate();
}

export function persistGitHubVersion(db: Db, principal: Principal, repository: RepositoryRecord, manifest: PackageManifest, release: ReleasePackage) {
  if (!isAdminOf(principal, repository.tenantId)) throw new RepositoryError(403, "forbidden", "only a squad ADMIN can publish");
  return db.transaction(() => {
    const stillAdmin = db.prepare("SELECT 1 FROM memberships WHERE user_id = ? AND tenant_id = ? AND role = 'ADMIN'")
      .get(principal.user.id, repository.tenantId);
    if (!stillAdmin) throw new RepositoryError(403, "forbidden", "publication permission was removed during synchronization");
    const existingTag = db.prepare("SELECT commit_sha AS commitSha, asset_id AS assetId, release_id AS releaseId FROM github_package_versions WHERE repository_id = ? AND tag = ?")
      .get(repository.id, release.tag) as { commitSha: string; assetId: number; releaseId: number } | undefined;
    if (existingTag && (existingTag.commitSha !== release.commitSha || existingTag.assetId !== release.assetId || existingTag.releaseId !== release.releaseId)) {
      throw new RepositoryError(409, "release_changed", "published release origin changed; publish a new version");
    }
    const result = insertPublishedVersion(db, principal.user.id, {
      tenantId: repository.tenantId, visibility: repository.visibility, manifest,
      digest: release.digest, sizeBytes: release.archive.byteLength,
    });
    if (result.status === "unchanged") {
      const origin = findGitHubVersion(db, result.versionId);
      if (!origin || origin.repositoryId !== repository.id || origin.tag !== release.tag) {
        throw new RepositoryError(409, "version_source_conflict", "version is already published from another source");
      }
    } else {
      db.prepare(`INSERT INTO github_package_versions(version_id, repository_id, tag, commit_sha, release_id, asset_id, asset_name)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(result.versionId, repository.id, release.tag, release.commitSha, release.releaseId, release.assetId, release.assetName);
      db.prepare("UPDATE plugins SET catalog_metadata = json_set(catalog_metadata, '$.source', json(?)) WHERE name = ?")
        .run(JSON.stringify({ kind: "internal", repository_url: repositoryUrl(repository) }), manifest.name);
    }
    db.prepare("UPDATE github_repositories SET last_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), last_version_id = ? WHERE id = ?")
      .run(result.versionId, repository.id);
    return result;
  }).immediate();
}

export function findGitHubVersion(db: Db, versionId: number) {
  return db.prepare(`SELECT r.owner, r.repo, g.repository_id AS repositoryId, g.asset_id AS assetId, g.tag
    FROM github_package_versions g JOIN github_repositories r ON r.id = g.repository_id WHERE g.version_id = ?`)
    .get(versionId) as { owner: string; repo: string; repositoryId: string; assetId: number; tag: string } | undefined;
}
