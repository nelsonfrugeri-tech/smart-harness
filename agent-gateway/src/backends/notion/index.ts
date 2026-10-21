import type { McpBackend, ToolContext, ToolDefinition } from "../../mcp/backend.ts";
import { argument, client, failure, fits, limit, record, result, text } from "../trello/shared.ts";

const TOOLS: ToolDefinition[] = [
  {
    name: "read_page", description: "Reads direct text blocks from an allowed page. Nested pages are not expanded.",
    inputSchema: { type: "object", properties: { page: { type: "string" }, cursor: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50 } }, required: ["page"] },
    access: { kind: "resource", resourceType: "page", extract: (args) => typeof args.page === "string" ? args.page : null },
  },
  {
    name: "search_pages", description: "Searches titles of explicitly allowed pages only, without a workspace-wide search.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, cursor: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50 } }, required: ["query"] },
    access: { kind: "search", resourceType: "page" },
  },
];

function pageId(value: string): string {
  if (!/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(value)) throw new Error("Invalid page ID.");
  return value.replaceAll("-", "").toLowerCase();
}

function allowedPages(ctx: ToolContext): string[] {
  return [...new Set((ctx.allowedResources.page ?? []).map(pageId))].sort();
}

function plainText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  // Mentions may contain titles of pages outside the allowlist. Only literal text is returned.
  return value.flatMap((part: unknown) => {
    const item = record(part);
    if (item.type !== "text") return [];
    const content = record(item.text).content;
    return typeof content === "string" ? [content] : [];
  }).join("");
}

function titleOf(page: Record<string, unknown>): string {
  const properties = record(page.properties);
  const title = Object.values(properties).map(record).find((property) => property.type === "title");
  return plainText(title?.title);
}

function summary(value: unknown, expectedId: string) {
  const page = record(value);
  if (pageId(argument(page, "id")) !== expectedId) throw new Error("Unexpected page.");
  const rawTitle = titleOf(page);
  return { id: expectedId, title: text(rawTitle, 600), source: `https://www.notion.so/${expectedId}`, truncated: text(rawTitle, 600) !== rawTitle };
}

function block(value: unknown) {
  const item = record(value);
  const type = argument(item, "type");
  // No child page, synced block, database, link, or mention content is exposed or followed.
  const safeTypes = ["paragraph", "heading_1", "heading_2", "heading_3", "bulleted_list_item", "numbered_list_item", "to_do", "toggle", "quote", "callout", "code"];
  if (!safeTypes.includes(type)) return null;
  const rawText = plainText(record(item[type]).rich_text);
  return { id: pageId(argument(item, "id")), type, text: text(rawText, 1200), truncated: text(rawText, 1200) !== rawText };
}

type Get = (path: string) => Promise<unknown>;

async function readPage(get: Get, ctx: ToolContext, args: Record<string, unknown>) {
  const id = pageId(argument(args, "page"));
  if (!allowedPages(ctx).includes(id)) return failure();
  const count = limit(args);
  const page = summary(await get(`pages/${id}`), id);
  if (args.cursor !== undefined && (typeof args.cursor !== "string" || args.cursor.length === 0)) throw new Error("Invalid cursor.");
  let cursor: string | null = typeof args.cursor === "string" ? args.cursor : null;
  const items: NonNullable<ReturnType<typeof block>>[] = [];
  let hasMore = true;
  // A one-block upstream page preserves the provider's opaque cursor at every output boundary.
  for (let scanned = 0; scanned < count && hasMore; scanned++) {
    const query = new URLSearchParams({ page_size: "1" });
    if (cursor !== null) query.set("start_cursor", cursor);
    const response = record(await get(`blocks/${id}/children?${query}`));
    if (!Array.isArray(response.results) || response.results.length > 1) throw new Error("Invalid blocks response.");
    const item = response.results.length === 0 ? null : block(response.results[0]);
    if (item !== null && !fits({ page, items: [...items, item] })) break;
    if (item !== null) items.push(item);
    hasMore = response.has_more === true;
    const next = response.next_cursor;
    if (hasMore && (typeof next !== "string" || next.length === 0 || next === cursor)) throw new Error("Invalid pagination response.");
    cursor = hasMore ? next as string : null;
  }
  return result({ page, items, next_cursor: cursor });
}

async function searchPages(get: Get, ctx: ToolContext, args: Record<string, unknown>) {
  if (typeof args.query !== "string" || args.query.length > 200) throw new Error("Invalid query.");
  const count = limit(args);
  const pages = allowedPages(ctx);
  const cursor = args.cursor === undefined ? "" : pageId(argument(args, "cursor"));
  const remaining = pages.filter((id) => id > cursor);
  const items: ReturnType<typeof summary>[] = [];
  let last = cursor;
  let scanned = 0;
  for (const id of remaining) {
    if (items.length >= count || scanned >= 50) break;
    const upstream = record(await get(`pages/${id}`));
    const page = summary(upstream, id);
    const matches = titleOf(upstream).toLowerCase().includes(args.query.toLowerCase());
    if (matches && !fits({ items: [...items, page] })) break;
    if (matches) items.push(page);
    last = id;
    scanned++;
  }
  return result({ items, next_cursor: scanned < remaining.length ? last : null });
}

export function createNotionBackend(config: { token: string; baseUrl?: string }): McpBackend {
  const get = client(config.baseUrl ?? "https://api.notion.com/v1/", {
    Authorization: `Bearer ${config.token}`, "Notion-Version": "2026-03-11", Accept: "application/json",
  });
  return {
    server: "notion",
    listTools: (ctx) => TOOLS.map((tool) => tool.name !== "read_page" ? tool : {
      ...tool,
      access: {
        kind: "resource", resourceType: "page",
        extract(args) {
          if (typeof args.page !== "string") return null;
          const requested = pageId(args.page);
          return (ctx.allowedResources.page ?? []).find((id) => pageId(id) === requested) ?? null;
        },
      },
    }),
    async callTool(ctx, name, args) {
      try {
        if (name === "read_page") return await readPage(get, ctx, args);
        if (name === "search_pages") return await searchPages(get, ctx, args);
        return failure();
      } catch { return failure(); }
    },
  };
}
