import { HttpProblem } from "./problem.ts";

// Lists answer {items, next_cursor}. The cursor is opaque to clients: base64url of the
// last key of the page. next_cursor is null on the last page.

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export const pageQuerySchema = {
  cursor: { type: "string", minLength: 1, maxLength: 256 },
  limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT },
} as const;

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export function encodeCursor(key: string | number): string {
  return Buffer.from(JSON.stringify({ k: key })).toString("base64url");
}

// Decodes a cursor made by encodeCursor with a key of the expected type; anything else is a 400.
export function decodeCursor(cursor: string | undefined, type: "string"): string | undefined;
export function decodeCursor(cursor: string | undefined, type: "number"): number | undefined;
export function decodeCursor(cursor: string | undefined, type: "string" | "number"): string | number | undefined {
  if (cursor === undefined) return undefined;
  try {
    const { k } = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { k?: unknown };
    if (typeof k === type) return k as string | number;
  } catch {
    // Falls through to the problem below.
  }
  throw new HttpProblem(400, "invalid_cursor", "cursor is invalid; start again without it");
}

// Lists ordered by (created_at, id) use the key "<created_at> <id>" of the last row of the page.
export function timeCursorKey(row: { createdAt: string; id: string }): string {
  return `${row.createdAt} ${row.id}`;
}

export function decodeTimeCursor(cursor: string | undefined): { createdAt: string; id: string } | undefined {
  const key = decodeCursor(cursor, "string");
  if (key === undefined) return undefined;
  const [createdAt, id, ...rest] = key.split(" ");
  if (!createdAt || !id || rest.length > 0) {
    throw new HttpProblem(400, "invalid_cursor", "cursor is invalid; start again without it");
  }
  return { createdAt, id };
}

// Repositories are asked for limit + 1 rows: the extra row only tells that another page exists.
export function toPage<T, K extends string | number>(
  rows: T[],
  limit: number,
  keyOf: (row: T) => K,
): { rows: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { rows, nextCursor: null };
  const page = rows.slice(0, limit);
  return { rows: page, nextCursor: encodeCursor(keyOf(page[page.length - 1])) };
}
