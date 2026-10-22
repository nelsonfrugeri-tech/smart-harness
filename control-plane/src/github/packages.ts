import { isDigest } from "../domain/marketplace.ts";
import { MAX_GITHUB_ARCHIVE_BYTES, RepositoryError, type GitHubPackages, type RepositoryIdentity } from "../domain/repositories.ts";

const API_ORIGIN = "https://api.github.com";
const DOWNLOAD_HOSTS = new Set(["release-assets.githubusercontent.com", "objects.githubusercontent.com"]);
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_TAG_DEPTH = 5;
const API_VERSION = "2026-03-10";

interface Asset { id: number; name: string; size: number; digest: string }

// Every URL is constructed here. JSON URLs supplied by GitHub are never followed. Credentials
// only reach api.github.com; binary redirects are bounded and restricted to GitHub's asset hosts.
// Phase 1 fails explicitly on upstream errors: no retries and no background work.
export function createGitHubPackages(options: { token?: string; fetch?: typeof fetch; timeoutMs?: number } = {}): GitHubPackages {
  const fetcher = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 60_000;

  async function bytes(url: string, binary: boolean, signal: AbortSignal): Promise<{ bytes: Uint8Array; headers: Headers }> {
    let target = new URL(url);
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const headers: Record<string, string> = { accept: binary ? "application/octet-stream" : "application/vnd.github+json" };
      if (target.origin === API_ORIGIN) {
        headers["X-GitHub-Api-Version"] = API_VERSION;
        headers["User-Agent"] = "smart-harness";
        if (options.token) headers.authorization = `Bearer ${options.token}`;
      }
      let response: Response;
      try { response = await fetcher(target, { headers, redirect: "manual", signal }); }
      catch { throw new RepositoryError(502, "github_unavailable", "GitHub request failed or timed out; try synchronizing again"); }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!binary || !location || redirects === MAX_REDIRECTS) throw upstream("GitHub returned an unsupported redirect");
        let next: URL;
        try { next = new URL(location, target); } catch { throw upstream("GitHub returned an invalid redirect"); }
        if (next.protocol !== "https:" || next.port || next.username || next.password || !DOWNLOAD_HOSTS.has(next.hostname)) {
          throw upstream("GitHub returned an untrusted download location");
        }
        target = next;
        continue;
      }
      if (response.status !== 200) {
        await response.body?.cancel();
        if (response.status === 404) throw new RepositoryError(422, "github_not_found", "GitHub repository, release, tag or asset was not found or is not accessible");
        throw upstream("GitHub could not serve the request; check its availability and the server token permissions or rate limit");
      }
      return { bytes: await readBounded(response, binary ? MAX_GITHUB_ARCHIVE_BYTES : MAX_JSON_BYTES), headers: response.headers };
    }
    throw upstream("GitHub redirect limit exceeded");
  }

  async function json(path: string, signal: AbortSignal): Promise<unknown> {
    const response = await bytes(API_ORIGIN + path, false, signal);
    if (response.headers.get("link")?.includes('rel="next"')) {
      throw new RepositoryError(422, "release_too_large", "a release may have at most 100 assets");
    }
    try { return JSON.parse(Buffer.from(response.bytes).toString("utf8")); }
    catch { throw upstream("GitHub returned invalid JSON"); }
  }

  const base = (repository: RepositoryIdentity) => `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`;

  async function resolveTag(path: string, tag: string, signal: AbortSignal): Promise<string> {
    const reference = object(await json(`${path}/git/ref/tags/${encodeURIComponent(tag)}`, signal));
    if (reference.ref !== `refs/tags/${tag}`) throw upstream("GitHub returned another tag reference");
    let target = object(reference.object);
    for (let depth = 0; depth <= MAX_TAG_DEPTH; depth += 1) {
      if (typeof target.sha !== "string" || !/^[0-9a-f]{40}$/.test(target.sha)) throw upstream("GitHub returned an invalid commit SHA");
      if (target.type === "commit") return target.sha;
      if (target.type !== "tag" || depth === MAX_TAG_DEPTH) break;
      const annotated = object(await json(`${path}/git/tags/${target.sha}`, signal));
      if (annotated.sha !== target.sha) throw upstream("GitHub returned another tag object");
      target = object(annotated.object);
    }
    throw new RepositoryError(422, "invalid_release", "release tag must resolve to a commit within five annotated tags");
  }

  return {
    async readRelease(repository, tag) {
      const signal = AbortSignal.timeout(timeoutMs);
      const path = base(repository);
      const release = object(await json(`${path}/releases/tags/${encodeURIComponent(tag)}`, signal));
      if (!positiveId(release.id) || release.tag_name !== tag || release.draft !== false || typeof release.published_at !== "string") {
        throw new RepositoryError(422, "invalid_release", "select a published GitHub Release matching the requested tag");
      }
      const rawAssets = await json(`${path}/releases/${release.id}/assets?per_page=100&page=1`, signal);
      if (!Array.isArray(rawAssets)) throw upstream("GitHub returned invalid release assets");
      const packages = rawAssets.map(object).filter((asset) => typeof asset.name === "string" && asset.name.endsWith(".tar.gz"));
      if (packages.length !== 1) throw new RepositoryError(422, "invalid_release", "release must contain exactly one .tar.gz package built by harness pack");
      const asset = parseAsset(packages[0]);
      const commitSha = await resolveTag(path, tag, signal);
      const archive = (await bytes(`${API_ORIGIN}${path}/releases/assets/${asset.id}`, true, signal)).bytes;
      if (archive.byteLength !== asset.size) throw new RepositoryError(422, "invalid_archive", "download size differs from the release asset metadata");
      if (await resolveTag(path, tag, signal) !== commitSha) {
        throw new RepositoryError(409, "release_changed", "release tag moved during synchronization; publish a new version");
      }
      return { tag, commitSha, releaseId: release.id, assetId: asset.id, assetName: asset.name, digest: asset.digest, archive };
    },
    async downloadAsset(repository, assetId) {
      if (!positiveId(assetId)) throw upstream("stored GitHub asset ID is invalid");
      return (await bytes(`${API_ORIGIN}${base(repository)}/releases/assets/${assetId}`, true, AbortSignal.timeout(timeoutMs))).bytes;
    },
  };
}

function parseAsset(asset: Record<string, unknown>): Asset {
  if (!positiveId(asset.id) || typeof asset.name !== "string" || asset.name.length > 255 || asset.state !== "uploaded"
    || !positiveId(asset.size) || asset.size > MAX_GITHUB_ARCHIVE_BYTES || typeof asset.digest !== "string" || !isDigest(asset.digest)) {
    throw new RepositoryError(422, "invalid_release", "package asset must be uploaded, within size limits and have a SHA-256 digest");
  }
  return { id: asset.id, name: asset.name, size: asset.size, digest: asset.digest };
}
function positiveId(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0; }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw upstream("GitHub returned an invalid object");
  return value as Record<string, unknown>;
}
function upstream(message: string): RepositoryError { return new RepositoryError(502, "github_unavailable", message); }

async function readBounded(response: Response, limit: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw upstream("GitHub returned an empty body");
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    if (Number(response.headers.get("content-length")) > limit) throw new RepositoryError(422, "response_too_large", "GitHub response exceeds the size limit");
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new RepositoryError(422, "response_too_large", "GitHub response exceeds the size limit");
      chunks.push(value);
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof RepositoryError) throw error;
    throw upstream("GitHub response failed or timed out");
  } finally { reader.releaseLock(); }
}
