import { createHash } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

interface Cursor { offset: number; snapshot?: string }
const IDENTITY_KEYS = ["id", "number", "sha", "html_url", "url", "path", "name"];

export function readCursor(cursor: unknown, binding: string): Cursor | null {
  if (cursor === undefined) return { offset: 0 };
  if (typeof cursor !== "string" || cursor.length > 500) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString()) as { binding: string; offset: number; snapshot: string };
    return value.binding === binding && Number.isSafeInteger(value.offset) && value.offset >= 0 && typeof value.snapshot === "string" ? value : null;
  } catch { return null; }
}
function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}
function compact(value: unknown): unknown {
  if (typeof value === "string") return value.length > 400 ? `${value.slice(0, 400)} [truncated]` : value;
  if (Array.isArray(value)) return value.map(compact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (IDENTITY_KEYS.includes(key) && (typeof item === "string" || typeof item === "number")) {
      return typeof item === "string" && item.length > 2048 ? [`${key}Unavailable`, true] : [key, item];
    }
    return [key, compact(item)];
  }));
  return value;
}
function preview(value: unknown): unknown {
  const data = compact(value);
  if (JSON.stringify(jsonResult(data)).length < 4000) return data;
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const identity: Record<string, unknown> = {};
  for (const key of IDENTITY_KEYS) {
    const item = record[key];
    if (typeof item !== "string" && typeof item !== "number") continue;
    if ((typeof item === "string" && item.length > 2048) || JSON.stringify(jsonResult({ ...identity, [key]: item })).length > 5000) {
      identity[`${key}Unavailable`] = true;
    } else {
      identity[key] = item;
    }
  }
  let excerpt = JSON.stringify(value).slice(0, 400);
  while (JSON.stringify(jsonResult({ ...identity, preview: excerpt, truncated: true })).length > 6500) excerpt = excerpt.slice(0, Math.floor(excerpt.length / 2));
  return { ...identity, preview: excerpt, truncated: true };
}
export function boundResult(result: CallToolResult, binding: string, cursor: Cursor): CallToolResult {
  const { offset } = cursor;
  const snapshot = createHash("sha256").update(JSON.stringify(result)).digest("hex");
  if (cursor.snapshot && cursor.snapshot !== snapshot) return { isError: true, content: [{ type: "text", text: '{"error":"upstream_page_changed","restartPage":true}' }] };
  if (!offset && JSON.stringify(result).length <= 7500) return result;
  let value: unknown = result.structuredContent;
  if (value === undefined) {
    const texts = result.content.filter((item) => item.type === "text");
    if (texts.length === 1) {
      try { value = JSON.parse(texts[0].text); } catch { value = texts[0].text; }
    }
  }
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  const items = Array.isArray(value) ? value : Array.isArray(record?.items) ? record.items : undefined;
  if (!items) return jsonResult({ data: preview(value ?? "Unsupported upstream content"), truncated: true });
  if (offset >= items.length) return { isError: true, content: [{ type: "text", text: '{"error":"invalid_cursor"}' }] };
  const page: unknown[] = [];
  let end = offset;
  while (end < items.length) {
    const candidate = preview(items[end]);
    if (JSON.stringify(jsonResult({ items: [...page, candidate] })).length > 7000) break;
    page.push(candidate);
    end++;
  }
  return jsonResult({ items: page, truncated: true, upstreamPageComplete: end === items.length,
    nextCursor: end < items.length ? Buffer.from(JSON.stringify({ binding, offset: end, snapshot })).toString("base64url") : null,
    ...(typeof record?.total_count !== "number" ? {} : { total_count: record.total_count }),
  });
}
