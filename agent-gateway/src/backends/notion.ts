import type { McpBackend, ToolDefinition } from "../mcp/backend.ts";
import { pageOfList, reduceObject, type Item } from "../mcp/limits.ts";
import { jsonResult, ToolError, withToolErrors } from "../mcp/result.ts";
import { asArray, asRecord, asString, fetchJson } from "./rest.ts";

// Notion through its REST API with the gateway's integration token.
// The hosted Notion MCP (mcp.notion.com) requires user-based OAuth and does not accept a bearer
// token, so it cannot use credentials injected by the gateway. These two read-only tools cover the use case.
// The resource type "page" is permitted per project in gateway_permissions (server "notion").
// Page ids are kept as 32 lowercase hex characters, without dashes, in the table and in the checks.

export interface NotionOptions {
  apiUrl: string;
  token: string;
  version: string;
}

const MAX_BLOCK_PAGES = 3;
const BLOCKS_PER_PAGE = 100;

// "1a2b...-..." or the plain 32 hex form; anything else is not a page id.
export function normalizePageId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.replaceAll("-", "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(id) ? id : null;
}

const TOOLS: ToolDefinition[] = [
  {
    name: "notion_get_page",
    description: "Reads an allowed page: title and the text of its top-level blocks.",
    inputSchema: { type: "object", properties: { page_id: { type: "string" } }, required: ["page_id"] },
    access: { kind: "resource", resourceType: "page", extract: (args) => normalizePageId(args.page_id) },
  },
  {
    name: "notion_search_pages",
    description:
      "Finds allowed pages whose title contains the query (all allowed pages when the query is empty). Never returns a page outside the project's allowed set.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, cursor: { type: "string" } } },
    access: { kind: "search", resourceType: "page" },
  },
];

export function notionBackend(options: NotionOptions): McpBackend {
  const headers = { Authorization: `Bearer ${options.token}`, "Notion-Version": options.version };
  const get = (path: string) => fetchJson("Notion", `${options.apiUrl}${path}`, { headers });

  return {
    server: "notion",
    listTools: () => TOOLS,
    callTool: (ctx, name, args) =>
      withToolErrors(async () => {
        if (name === "notion_get_page") {
          const pageId = normalizePageId(args.page_id);
          if (pageId === null) throw new ToolError("page_id is required.");
          return jsonResult(await getPage(get, pageId));
        }
        if (name === "notion_search_pages") {
          const query = typeof args.query === "string" ? args.query : "";
          const cursor = typeof args.cursor === "string" ? args.cursor : undefined;
          return jsonResult(await searchPages(get, ctx.allowedResources.page ?? [], query, cursor));
        }
        throw new ToolError(`Unknown tool ${name}.`);
      }),
  };
}

type Get = (path: string) => Promise<unknown>;

// Notion search cannot be limited to a set of pages and only matches titles. So the gateway reads
// each allowed page and filters by title: the result can never contain a page outside the set.
async function searchPages(get: Get, allowed: readonly string[], query: string, cursor: string | undefined) {
  const settled = await Promise.allSettled(allowed.map((id) => get(`/pages/${id}`)));
  const pages = settled
    .flatMap((entry) => (entry.status === "fulfilled" ? [asRecord(entry.value)] : []))
    // Defense in depth: keep a page only when Notion answers with an id of the allowed set.
    .filter((page) => allowed.includes(normalizePageId(page.id) ?? ""));
  if (allowed.length > 0 && pages.length === 0) {
    throw new ToolError("Notion could not read any allowed page. Check that the integration is shared with them.");
  }
  const needle = query.trim().toLowerCase();
  const items: Item[] = pages
    .filter((page) => needle === "" || titleOf(page).toLowerCase().includes(needle))
    .map((page) => pageSummary(page))
    .sort((a, b) => a.id.localeCompare(b.id));
  return pageOfList(items, cursor);
}

async function getPage(get: Get, pageId: string) {
  const page = asRecord(await get(`/pages/${pageId}`));
  const lines: string[] = [];
  let startCursor: string | null = null;
  for (let fetched = 0; fetched < MAX_BLOCK_PAGES; fetched++) {
    const query: string = `page_size=${BLOCKS_PER_PAGE}` + (startCursor === null ? "" : `&start_cursor=${encodeURIComponent(startCursor)}`);
    const blocks = asRecord(await get(`/blocks/${pageId}/children?${query}`));
    lines.push(...asArray(blocks.results).map((block) => blockText(asRecord(block))).filter((line) => line !== ""));
    startCursor = blocks.has_more === true && typeof blocks.next_cursor === "string" ? blocks.next_cursor : null;
    if (startCursor === null) break;
  }
  return reduceObject({
    ...pageSummary(page),
    content: lines.join("\n"),
    content_complete: startCursor === null,
  });
}

function pageSummary(page: Record<string, unknown>): Item {
  const id = asString(page.id);
  return {
    id,
    source: `notion:page/${id}`,
    title: titleOf(page),
    url: asString(page.url),
    last_edited_time: asString(page.last_edited_time),
  };
}

// The title is the property of type "title", whatever its name.
function titleOf(page: Record<string, unknown>): string {
  for (const property of Object.values(asRecord(page.properties))) {
    const p = asRecord(property);
    if (p.type === "title") return plainText(p.title);
  }
  return "";
}

function plainText(richText: unknown): string {
  return asArray(richText).map((part) => asString(asRecord(part).plain_text)).join("");
}

const PREFIXES: Record<string, string> = {
  heading_1: "# ",
  heading_2: "## ",
  heading_3: "### ",
  bulleted_list_item: "- ",
  numbered_list_item: "1. ",
  quote: "> ",
};

function blockText(block: Record<string, unknown>): string {
  const type = asString(block.type);
  const body = asRecord(block[type]);
  const text = plainText(body.rich_text);
  if (type === "to_do") return `[${body.checked === true ? "x" : " "}] ${text}`;
  return `${PREFIXES[type] ?? ""}${text}`;
}
