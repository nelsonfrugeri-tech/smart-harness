// Model upstream settings. Kept apart from the main config so the proxy can be read on its own.

export const DEFAULT_MODEL_UPSTREAM_URL = "https://openrouter.ai/api";

export interface ModelUpstream {
  // Base URL without a trailing slash; the proxy appends the request path (/v1/messages).
  url: string;
  // The organization's provider key. It is sent upstream only and never logged or stored.
  key: string;
}

// Returns undefined when no key is set: the gateway still starts and /v1/messages answers 503.
export function loadModelUpstream(env: NodeJS.ProcessEnv = process.env): ModelUpstream | undefined {
  const key = env.MODEL_UPSTREAM_KEY?.trim() ?? "";
  if (key === "") return undefined;
  const raw = env.MODEL_UPSTREAM_URL?.trim() || DEFAULT_MODEL_UPSTREAM_URL;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("MODEL_UPSTREAM_URL must be an absolute http(s) URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("MODEL_UPSTREAM_URL must be an absolute http(s) URL");
  }
  if (parsed.search !== "" || parsed.hash !== "") {
    throw new Error("MODEL_UPSTREAM_URL must not have a query string or fragment");
  }
  return { url: raw.replace(/\/+$/, ""), key };
}
