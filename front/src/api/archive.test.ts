import { beforeEach, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { gzipSync } from "node:zlib";
import { fetchArchive } from "./archive";
import { plan, json } from "../test/fixtures";
const bytes = Uint8Array.from(gzipSync("Package archive test"));
const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const version = {
  ...plan.baseline[0].version,
  size_bytes: bytes.length,
  digest,
  archive_url: "/v1/plugins/investment-base/versions/1.0.0/archive",
};
const headers = {
  "content-type": "application/gzip",
  "x-package-digest": digest,
};
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});
it("authenticates a same-origin download without HTTP cache and verifies its bytes", async () => {
  const fetcher = vi.fn(async () => new Response(bytes, { headers }));
  vi.stubGlobal("fetch", fetcher);
  const blob = await fetchArchive(
    "investment-base",
    version,
    "private-token",
    new AbortController().signal,
  );
  expect(blob.size).toBe(bytes.length);
  expect(fetcher).toHaveBeenCalledWith(
    version.archive_url,
    expect.objectContaining({
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      headers: {
        Accept: "application/gzip",
        Authorization: "Bearer private-token",
      },
    }),
  );
});
it.each([401, 404, 500])(
  "rejects Problem JSON status %s without creating an archive",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(
          { code: "download_problem", correlation_id: "archive-trace" },
          status,
        ),
      ),
    );
    await expect(
      fetchArchive(
        "investment-base",
        version,
        "token",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      status,
      code: "download_problem",
      correlationId: "archive-trace",
    });
  },
);
it.each(["json", "signature", "digest", "size", "header"])(
  "rejects invalid archive %s",
  async (failure) => {
    const data =
      failure === "signature"
        ? new Uint8Array(bytes.length)
        : Uint8Array.from(bytes);
    if (failure === "digest") data[data.length - 1] ^= 1;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(data, {
            headers: {
              ...headers,
              ...(failure === "json"
                ? { "content-type": "application/problem+json" }
                : {}),
              ...(failure === "header"
                ? { "x-package-digest": "sha256:wrong" }
                : {}),
            },
          }),
      ),
    );
    await expect(
      fetchArchive(
        "investment-base",
        failure === "size"
          ? { ...version, size_bytes: bytes.length + 1 }
          : version,
        "token",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: failure === "digest" ? "digest_mismatch" : "invalid_archive",
    });
  },
);
it("rejects external archive URLs before attaching credentials", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(
    fetchArchive(
      "investment-base",
      { ...version, archive_url: "https://example.com/archive" },
      "secret",
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "invalid_archive" });
  expect(fetcher).not.toHaveBeenCalled();
});
