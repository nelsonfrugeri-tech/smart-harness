import { ToolError } from "./result.ts";

// Keeps one tool response under MAX_RESPONSE_CHARS without breaking its JSON.
// - A singular object is reduced field by field (reduceObject), always keeping id and source.
// - A list is cut to the items that fit, and next_cursor names the last item actually returned,
//   so the next call continues right after it (pageOfList).

export const MAX_RESPONSE_CHARS = 8000;
export const MAX_ITEMS_PER_PAGE = 50;

// Every item of a gateway list carries an id (unique in the list) and the source it came from.
export interface Item {
  id: string;
  source: string;
  [field: string]: unknown;
}

export interface ListPage {
  items: Item[];
  // Absent on the last page.
  next_cursor?: string;
}

const MAX_KEY_LENGTH = 200;
// Longest value kept per field, tried in this order until the object fits.
const FIELD_CAPS = [2000, 1000, 500, 250, 120, 60, 20];

export function reduceObject(item: Item, maxChars = MAX_RESPONSE_CHARS): Item {
  if (JSON.stringify(item).length <= maxChars) return item;
  const { id, source, ...fields } = item;
  const key = { id: id.slice(0, MAX_KEY_LENGTH), source: source.slice(0, MAX_KEY_LENGTH) };
  for (const cap of FIELD_CAPS) {
    const candidate = { ...key, ...(shrink(fields, cap) as object), truncated: true };
    if (JSON.stringify(candidate).length <= maxChars) return candidate;
  }
  return { ...key, truncated: true };
}

// Strings are cut to `cap` characters and arrays keep the first items; numbers and booleans stay.
function shrink(value: unknown, cap: number): unknown {
  if (typeof value === "string") return value.length > cap ? `${value.slice(0, cap)}…` : value;
  if (Array.isArray(value)) return value.slice(0, Math.max(1, Math.floor(cap / 20))).map((entry) => shrink(entry, cap));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, shrink(entry, cap)]));
  }
  return value;
}

// `all` is the complete list in a stable order. The cursor is the id of the last item the previous
// page returned (opaque to the caller). An unknown cursor is an error, never a restart from zero.
export function pageOfList(all: readonly Item[], cursor: string | undefined, maxChars = MAX_RESPONSE_CHARS): ListPage {
  const start = cursor === undefined ? 0 : indexAfter(all, cursor);
  let items = all.slice(start, start + MAX_ITEMS_PER_PAGE);
  const envelope = (shown: Item[]): ListPage => {
    const last = shown[shown.length - 1];
    const more = last !== undefined && start + shown.length < all.length;
    return more ? { items: shown, next_cursor: encodeCursor(last.id) } : { items: shown };
  };
  while (items.length > 1 && JSON.stringify(envelope(items)).length > maxChars) {
    items = items.slice(0, -1);
  }
  const [only] = items;
  if (items.length === 1 && only !== undefined && JSON.stringify(envelope(items)).length > maxChars) {
    // A single item that does not fit: reduce it so the page still advances.
    const overhead = JSON.stringify(envelope([{ id: "", source: "" }])).length + 2 * MAX_KEY_LENGTH + 200;
    items = [reduceObject(only, Math.max(maxChars - overhead, 0))];
  }
  return envelope(items);
}

function indexAfter(all: readonly Item[], cursor: string): number {
  let id: string;
  try {
    id = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new ToolError("Invalid cursor.");
  }
  const index = all.findIndex((item) => item.id === id);
  if (index === -1) throw new ToolError("Invalid cursor: the item it points to no longer exists. Start again without a cursor.");
  return index + 1;
}

function encodeCursor(id: string): string {
  return Buffer.from(id, "utf8").toString("base64url");
}
