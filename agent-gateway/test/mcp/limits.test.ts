import { describe, expect, it } from "vitest";
import { MAX_RESPONSE_CHARS, pageOfList, reduceObject, type Item, type ListPage } from "../../src/mcp/limits.ts";
import { ToolError } from "../../src/mcp/result.ts";

function item(n: number, size = 300): Item {
  return { id: `BL-${String(n).padStart(3, "0")}`, source: `p/docs/backlog/BL-${n}.md`, title: "t".repeat(size) };
}

// Walks every page with the cursor, like a client would.
function walk(all: Item[]): ListPage[] {
  const pages: ListPage[] = [];
  let cursor: string | undefined;
  do {
    const page = pageOfList(all, cursor);
    pages.push(page);
    cursor = page.next_cursor;
  } while (cursor !== undefined && pages.length < 1000);
  return pages;
}

describe("reduceObject", () => {
  it("returns an object under the limit untouched", () => {
    const small = { id: "BL-1", source: "s", body: "short" };

    expect(reduceObject(small)).toBe(small);
  });

  it("reduces a large object to valid JSON under the limit, keeping id and source", () => {
    const large: Item = {
      id: "BL-1",
      source: "p/docs/backlog/BL-1.md",
      title: "Title",
      status: "ready",
      criteria: Array.from({ length: 400 }, (_, i) => `criterion ${i} ${"x".repeat(100)}`),
      body: "y".repeat(50_000),
    };

    const reduced = reduceObject(large);

    const text = JSON.stringify(reduced);
    expect(text.length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
    expect(JSON.parse(text)).toMatchObject({ id: "BL-1", source: "p/docs/backlog/BL-1.md", title: "Title", status: "ready", truncated: true });
  });

  it("falls back to id, source and the truncated flag when no field fits", () => {
    const fields = Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [`field_${i}`, "v"]));

    const reduced = reduceObject({ id: "X", source: "S", ...fields });

    expect(reduced).toEqual({ id: "X", source: "S", truncated: true });
  });
});

describe("pageOfList", () => {
  it("returns a short list in one page without a cursor", () => {
    const page = pageOfList([item(1), item(2)], undefined);

    expect(page.items.map((i) => i.id)).toEqual(["BL-001", "BL-002"]);
    expect(page.next_cursor).toBeUndefined();
  });

  it("walks a long list and returns every item exactly once, in order, with each page under the limit", () => {
    const all = Array.from({ length: 120 }, (_, i) => item(i + 1));

    const pages = walk(all);

    expect(pages.length).toBeGreaterThan(3);
    expect(pages.flatMap((p) => p.items.map((i) => i.id))).toEqual(all.map((i) => i.id));
    for (const page of pages) expect(JSON.stringify(page).length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
    expect(pages.at(-1)?.next_cursor).toBeUndefined();
  });

  it("starts the next page right after the last item returned when the size limit cut the page", () => {
    const all = Array.from({ length: 40 }, (_, i) => item(i + 1, 500));

    const first = pageOfList(all, undefined);
    const second = pageOfList(all, first.next_cursor);

    expect(first.items.length).toBeLessThan(40);
    expect(first.items.length).toBeLessThan(50);
    const lastOfFirst = first.items.at(-1)?.id;
    expect(second.items[0]?.id).toBe(`BL-${String(Number(lastOfFirst?.slice(3)) + 1).padStart(3, "0")}`);
  });

  it("reduces one oversized item in the middle and still advances without losing the others", () => {
    const all = Array.from({ length: 30 }, (_, i) => item(i + 1));
    all[9] = { ...item(10), body: "z".repeat(40_000) };

    const pages = walk(all);

    const returned = pages.flatMap((p) => p.items);
    expect(returned.map((i) => i.id)).toEqual(all.map((i) => i.id));
    expect(returned[9]).toMatchObject({ id: "BL-010", truncated: true });
    for (const page of pages) expect(JSON.stringify(page).length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
  });

  it("rejects a cursor that points to no item instead of restarting the list", () => {
    const bad = Buffer.from("BL-999", "utf8").toString("base64url");

    expect(() => pageOfList([item(1)], bad)).toThrow(ToolError);
  });
});
