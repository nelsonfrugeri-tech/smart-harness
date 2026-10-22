export const DEFAULT_INSTALLER_VERSION = "v0.2.1";
export const DEFAULT_PUBLIC_API_URL = "http://127.0.0.1:8080";

export interface InstallerConfig {
  publicApiUrl: string;
  installerVersion: string;
  installerAssetsDir?: string;
}

export function publicApiUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("PUBLIC_API_URL must be an absolute HTTPS URL or HTTP loopback URL"); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (Array.from(value).some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127) || url.username || url.password || url.search || url.hash
    || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) {
    throw new Error("PUBLIC_API_URL must use HTTPS or HTTP loopback, without credentials, query or fragment");
  }
  return url.toString().replace(/\/+$/, "");
}

export function installerVersion(value: string): string {
  if (!/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(value)) throw new Error("INSTALLER_VERSION must use vMAJOR.MINOR.PATCH");
  return value;
}

