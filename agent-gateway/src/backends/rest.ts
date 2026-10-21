import { ToolError } from "../mcp/result.ts";

// One GET/POST to an upstream REST API, answered as JSON. No retry: a failure is reported once.
// Error messages carry only the service name and the HTTP status, never the URL, headers or body,
// because those can hold credentials or data the developer may not see.

const TIMEOUT_MS = 15_000;

export async function fetchJson(
  service: string,
  url: string,
  init: { method?: string; headers: Record<string, string>; body?: unknown },
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? "GET",
      headers: { Accept: "application/json", ...(init.body === undefined ? {} : { "Content-Type": "application/json" }), ...init.headers },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ToolError(`${service} is unreachable.`);
  }
  if (!response.ok) {
    throw new ToolError(`${service} answered HTTP ${response.status}.`);
  }
  try {
    return await response.json();
  } catch {
    throw new ToolError(`${service} answered with a body that is not JSON.`);
  }
}

// Reads a field of an upstream JSON value without trusting its shape.
export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
