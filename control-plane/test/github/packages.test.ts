import { describe, expect, it, vi } from "vitest";
import { createGitHubPackages } from "../../src/github/packages.ts";
import { digestOf } from "../../src/domain/marketplace.ts";
import { MAX_GITHUB_ARCHIVE_BYTES } from "../../src/domain/repositories.ts";

const repository = { owner: "example", repo: "agent-demo" };
const archive = Buffer.from("published archive");
const sha = "a".repeat(40);
const tagSha = "b".repeat(40);
const release = { id: 11, tag_name: "v1.0.0", draft: false, published_at: "2026-10-22T00:00:00Z" };
const asset = { id: 22, name: "agent-demo-1.0.0.tar.gz", state: "uploaded", size: archive.byteLength, digest: digestOf(archive) };
const ref = { ref: "refs/tags/v1.0.0", object: { type: "commit", sha } };

function fixture(overrides: Record<string, () => Response | Promise<Response>> = {}) {
  const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    expect(init?.redirect).toBe("manual");
    const url = new URL(String(input));
    const path = url.pathname.replace("/repos/example/agent-demo", "");
    if (overrides[path]) return overrides[path]();
    if (path === "/releases/tags/v1.0.0") return Response.json(release);
    if (path === "/releases/11/assets") {
      expect(url.search).toBe("?per_page=100&page=1");
      return Response.json([asset, { name: "SHA256SUMS" }]);
    }
    if (path === "/git/ref/tags/v1.0.0") return Response.json(ref);
    if (path === "/releases/assets/22") return new Response(archive);
    throw new Error("unexpected URL");
  });
  return { fetcher, client: createGitHubPackages({ fetch: fetcher, token: "server-only-secret", timeoutMs: 200 }) };
}

describe("GitHub package client", () => {
  it("reads one published Release and pins the asset and the resolved lightweight commit", async () => {
    const { client, fetcher } = fixture();
    expect(await client.readRelease(repository, "v1.0.0")).toEqual({
      tag: "v1.0.0", commitSha: sha, releaseId: 11, assetId: 22, assetName: asset.name, digest: asset.digest, archive,
    });
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ authorization: "Bearer server-only-secret" });
  });

  it("resolves annotated tags to their commit and bounds recursion", async () => {
    const overrides = {
      "/git/ref/tags/v1.0.0": () => Response.json({ ...ref, object: { type: "tag", sha: tagSha } }),
      [`/git/tags/${tagSha}`]: () => Response.json({ sha: tagSha, object: { type: "commit", sha } }),
    };
    expect((await fixture(overrides).client.readRelease(repository, "v1.0.0")).commitSha).toBe(sha);
    overrides[`/git/tags/${tagSha}`] = () => Response.json({ sha: tagSha, object: { type: "tag", sha: tagSha } });
    await expect(fixture(overrides).client.readRelease(repository, "v1.0.0")).rejects.toMatchObject({ status: 422, code: "invalid_release" });
  });

  it("rejects a tag moved while downloading", async () => {
    let refs = 0;
    const { client } = fixture({ "/git/ref/tags/v1.0.0": () => Response.json({ ...ref, object: { type: "commit", sha: refs++ === 0 ? sha : tagSha } }) });
    await expect(client.readRelease(repository, "v1.0.0")).rejects.toMatchObject({ status: 409, code: "release_changed" });
  });

  it("strips the server credential on asset redirects and keeps public downloads unauthenticated", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      if (new URL(String(input)).hostname === "api.github.com") {
        expect(init?.headers).toMatchObject({ authorization: "Bearer secret" });
        return new Response(null, { status: 302, headers: { location: "https://release-assets.githubusercontent.com/github-production-release-asset/file?signature=private" } });
      }
      expect(init?.headers).not.toHaveProperty("authorization");
      return new Response(archive);
    });
    expect(await createGitHubPackages({ fetch: fetcher, token: "secret" }).downloadAsset(repository, 22)).toEqual(archive);
    const publicFetch = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      expect(init?.headers).not.toHaveProperty("authorization");
      return new Response(archive);
    });
    await createGitHubPackages({ fetch: publicFetch }).downloadAsset(repository, 22);
  });

  it.each(["http://release-assets.githubusercontent.com/a", "https://evil.example/a", "https://api.github.com/a", "https://release-assets.githubusercontent.com:444/a", "https://secret@release-assets.githubusercontent.com/a", "http://127.0.0.1/a"])("rejects redirect %s without requesting it", async (location) => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location } }));
    await expect(createGitHubPackages({ fetch: fetcher }).downloadAsset(repository, 22)).rejects.toMatchObject({ code: "github_unavailable" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects JSON redirects, HTTP errors and invalid JSON without exposing provider bodies", async () => {
    for (const response of [new Response("private upstream message", { status: 401 }), new Response(null, { status: 302, headers: { location: "https://evil.example" } }), new Response("bad json")]) {
      const { client } = fixture({ "/releases/tags/v1.0.0": () => response });
      await expect(client.readRelease(repository, "v1.0.0")).rejects.toMatchObject({ status: 502, code: "github_unavailable" });
    }
  });

  it.each([
    ["draft", { "/releases/tags/v1.0.0": () => Response.json({ ...release, draft: true }) }],
    ["missing asset", { "/releases/11/assets": () => Response.json([]) }],
    ["ambiguous assets", { "/releases/11/assets": () => Response.json([asset, { ...asset, id: 23 }]) }],
    ["missing digest", { "/releases/11/assets": () => Response.json([{ ...asset, digest: null }]) }],
    ["oversized asset", { "/releases/11/assets": () => Response.json([{ ...asset, size: MAX_GITHUB_ARCHIVE_BYTES + 1 }]) }],
    ["truncated asset", { "/releases/assets/22": () => new Response("short") }],
    ["too many assets", { "/releases/11/assets": () => Response.json([asset], { headers: { link: '<https://api.github.com/next>; rel="next"' } }) }],
    ["not found", { "/releases/tags/v1.0.0": () => new Response(null, { status: 404 }) }],
  ])("refuses %s", async (_name, overrides) => {
    await expect(fixture(overrides).client.readRelease(repository, "v1.0.0")).rejects.toMatchObject({ status: 422 });
  });

  it("bounds streamed response bytes even without content-length", async () => {
    const { client } = fixture({ "/releases/tags/v1.0.0": () => new Response("x".repeat(1024 * 1024 + 1)) });
    await expect(client.readRelease(repository, "v1.0.0")).rejects.toMatchObject({ code: "response_too_large" });
  });

  it("turns the total request deadline into an explicit sanitized upstream failure", async () => {
    const fetcher: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("token and signed URL must not be exposed")), { once: true });
    });
    await expect(createGitHubPackages({ fetch: fetcher, timeoutMs: 5 }).readRelease(repository, "v1.0.0"))
      .rejects.toMatchObject({ status: 502, code: "github_unavailable" });
  });
});
