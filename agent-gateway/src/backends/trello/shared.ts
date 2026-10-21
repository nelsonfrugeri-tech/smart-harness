import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid upstream response.");
  return value as Record<string, unknown>;
}

export function text(value: unknown, max = 600): string {
  if (typeof value !== "string") return "";
  let clipped = value.slice(0, max);
  while (Buffer.byteLength(JSON.stringify(clipped)) > max) clipped = clipped.slice(0, -1);
  return clipped;
}

export function argument(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0 || value.length > 200) throw new Error("Invalid arguments.");
  return value;
}

export function limit(args: Record<string, unknown>): number {
  const value = args.limit ?? 10;
  if (!Number.isInteger(value) || typeof value !== "number" || value < 1 || value > 50) throw new Error("Invalid limit.");
  return value;
}

export function result(data: unknown): CallToolResult {
  const serialized = JSON.stringify(data);
  if (Buffer.byteLength(serialized) > 8000) throw new Error("Response exceeds size limit.");
  return { content: [{ type: "text", text: serialized }] };
}

export function fits(data: unknown): boolean {
  return Buffer.byteLength(JSON.stringify(data)) <= 7000;
}

export function failure(): CallToolResult {
  return { isError: true, content: [{ type: "text", text: "The backend could not complete the request." }] };
}

export function client(baseUrl: string, headers: Record<string, string>): (path: string) => Promise<unknown> {
  const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  if (base.username || base.password || base.search || base.hash || !["https:", "http:"].includes(base.protocol)) throw new Error("Invalid backend URL.");
  return async (path) => {
    const response = await fetch(new URL(path, base), { headers, redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error("Upstream request failed."); }
    return response.json() as Promise<unknown>;
  };
}
