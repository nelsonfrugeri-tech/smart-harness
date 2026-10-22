import type { Db } from "../db/database.ts";
import { persistGitHubVersion, type RepositoryRecord } from "../db/repos/repositories.ts";
import type { Principal } from "./access.ts";
import { digestOf, type PackageManifest } from "./marketplace.ts";

export const MAX_GITHUB_ARCHIVE_BYTES = 50 * 1024 * 1024 + 2000 * 1024 + 1024 * 1024;
export const RELEASE_TAG_PATTERN = "^v?[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?$";

export class RepositoryError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "RepositoryError";
    this.status = status;
    this.code = code;
  }
}

export interface RepositoryIdentity { owner: string; repo: string }
export interface ReleaseOrigin {
  tag: string;
  commitSha: string;
  releaseId: number;
  assetId: number;
  assetName: string;
}
export interface ReleasePackage extends ReleaseOrigin {
  digest: string;
  archive: Uint8Array;
}
export interface GitHubPackages {
  readRelease(repository: RepositoryIdentity, tag: string): Promise<ReleasePackage>;
  downloadAsset(repository: RepositoryIdentity, assetId: number): Promise<Uint8Array>;
}
export type PackageInspector = (archive: Uint8Array, digest: string) => Promise<PackageManifest>;

export async function syncRepository(
  deps: { db: Db; github: GitHubPackages; inspectPackage: PackageInspector },
  principal: Principal,
  repository: RepositoryRecord,
  tag: string,
) {
  const release = await deps.github.readRelease(repository, tag);
  if (release.archive.byteLength === 0 || release.archive.byteLength > MAX_GITHUB_ARCHIVE_BYTES) {
    throw new RepositoryError(422, "invalid_archive", "release archive is empty or too large");
  }
  if (digestOf(release.archive) !== release.digest) {
    throw new RepositoryError(422, "digest_mismatch", "release archive does not match its SHA-256 digest");
  }
  const manifest = await deps.inspectPackage(release.archive, release.digest);
  if (tag.replace(/^v/, "") !== manifest.version) {
    throw new RepositoryError(422, "version_mismatch", "release tag must match plugin.json version");
  }
  const result = persistGitHubVersion(deps.db, principal, repository, manifest, release);
  return {
    status: result.status,
    plugin: manifest.name,
    version: manifest.version,
    digest: release.digest,
    commit_sha: release.commitSha,
    release_url: `${repositoryUrl(repository)}/releases/tag/${encodeURIComponent(tag)}`,
  };
}

export function repositoryUrl(repository: RepositoryIdentity): string {
  return `https://github.com/${repository.owner}/${repository.repo}`;
}
