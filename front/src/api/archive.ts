import { ApiError, readProblem, type PluginVersion } from "./client";
async function validateArchive(response: Response, version: PluginVersion) {
  if (
    response.headers.get("content-type")?.split(";")[0].trim() !==
      "application/gzip" ||
    response.headers.get("x-package-digest") !== version.digest
  )
    throw new ApiError(0, "invalid_archive");
  const bytes = await response.arrayBuffer();
  const header = new Uint8Array(bytes, 0, Math.min(3, bytes.byteLength));
  if (
    bytes.byteLength !== version.size_bytes ||
    header[0] !== 0x1f ||
    header[1] !== 0x8b ||
    header[2] !== 8
  )
    throw new ApiError(0, "invalid_archive");
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const digest = `sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  if (digest !== version.digest) throw new ApiError(0, "digest_mismatch");
  return new Blob([bytes], { type: "application/gzip" });
}
export async function fetchArchive(
  name: string,
  version: PluginVersion,
  token: string,
  ownerSignal: AbortSignal,
) {
  const path = `/v1/plugins/${encodeURIComponent(name)}/versions/${encodeURIComponent(version.version)}/archive`;
  if (version.archive_url !== path) throw new ApiError(0, "invalid_archive");
  const signal = AbortSignal.any([ownerSignal, AbortSignal.timeout(30000)]);
  try {
    const response = await fetch(path, {
      headers: { Accept: "application/gzip", Authorization: `Bearer ${token}` },
      signal,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    });
    if (!response.ok) throw await readProblem(response);
    const blob = await validateArchive(response, version);
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    return blob;
  } catch (error) {
    if (ownerSignal.aborted) throw new DOMException("Cancelled", "AbortError");
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, signal.aborted ? "timeout" : "network_error");
  }
}
