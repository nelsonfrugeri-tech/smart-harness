import { createHash } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ProjectDocument } from "./documents.ts";

const MAX_RESPONSE = 8000;

export function textResult(value: unknown, isError = false): CallToolResult {
  const text = JSON.stringify(value);
  if (text.length > MAX_RESPONSE) throw new Error("Response metadata exceeds the size limit.");
  return { ...(isError ? { isError: true } : {}), content: [{ type: "text", text }] };
}

export function truncate<T extends { content: string; truncated: boolean }>(item: T, envelope: (value: T) => unknown): T {
  if (JSON.stringify(envelope(item)).length <= MAX_RESPONSE) return item;
  item = reduceMetadata(item, envelope);
  let low = 0;
  let high = item.content.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (JSON.stringify(envelope({ ...item, content: item.content.slice(0, middle), truncated: true })).length <= MAX_RESPONSE) low = middle;
    else high = middle - 1;
  }
  return { ...item, content: item.content.slice(0, low), truncated: true };
}

function reduceMetadata<T extends { content: string; truncated: boolean }>(item: T, envelope: (value: T) => unknown): T {
  if (JSON.stringify(envelope({ ...item, content: "", truncated: true })).length <= MAX_RESPONSE) return item;
  const result: Record<string, unknown> = { ...item, truncated: true, metadataTruncated: true };
  for (const [field, identities] of [["metadata", ["id", "title"]], ["manifest", ["id", "name", "source"]]] as const) {
    const value = result[field];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const data = value as Record<string, unknown>;
      result[field] = { ...Object.fromEntries(identities.filter((key) => Object.hasOwn(data, key)).map((key) => [key, data[key]])), metadataTruncated: true };
    }
  }
  return result as T;
}

export function page(documents: ProjectDocument[], args: Record<string, unknown>, scope: string): CallToolResult {
  const limit = args.limit === undefined ? 20 : args.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid limit.");
  const fingerprint = createHash("sha256").update(JSON.stringify([scope, documents.map((document) => [document.id, document.source, document.content, document.metadata])])).digest("hex").slice(0, 24);
  const start = parseCursor(args.cursor, fingerprint, documents.length);
  const items: ProjectDocument[] = [];
  const cursor = (offset: number) => offset < documents.length ? Buffer.from(`${fingerprint}:${offset}`).toString("base64url") : null;
  for (let index = start; index < documents.length && items.length < limit; index++) {
    const next = cursor(index + 1);
    const item = documents[index];
    if (JSON.stringify({ items: [...items, item], next_cursor: next }).length > MAX_RESPONSE) {
      if (items.length > 0) break;
      items.push(truncate(item, (value) => ({ items: [value], next_cursor: next })));
      break;
    }
    items.push(item);
  }
  return textResult({ items, next_cursor: cursor(start + items.length) });
}

function parseCursor(value: unknown, fingerprint: string, length: number): number {
  if (value === undefined) return 0;
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) throw new Error("Invalid cursor.");
  const decoded = Buffer.from(value, "base64url").toString("utf8");
  const match = /^([a-f0-9]{24}):([1-9][0-9]*)$/.exec(decoded);
  if (!match || match[1] !== fingerprint || Buffer.from(decoded).toString("base64url") !== value) throw new Error("Invalid cursor.");
  const index = Number(match[2]);
  if (!Number.isSafeInteger(index) || index >= length) throw new Error("Invalid cursor.");
  return index;
}
