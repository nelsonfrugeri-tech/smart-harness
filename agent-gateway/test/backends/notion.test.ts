import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { echoBackend } from "../../src/backends/echo.ts";
import { executeToolCall } from "../../src/mcp/tool-call.ts";
import { createNotionBackend } from "../../src/backends/notion/index.ts";
import type { ToolContext } from "../../src/mcp/backend.ts";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const page = "11111111111111111111111111111111";
const forbidden = "99999999999999999999999999999999";
const ctx: ToolContext = { userId: "u", project: { id: "p", slug: "p", tenantId: "t" }, server: "notion", correlationId: "c", allowedResources: { page: [page] } };
const close: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of close.splice(0)) await cleanup(); });
async function server(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const instance = createServer(handler);
  await new Promise<void>((resolve, reject) => { instance.once("error", reject); instance.listen(0, "127.0.0.1", resolve); });
  close.push(() => new Promise<void>((resolve, reject) => instance.close((error) => error ? reject(error) : resolve())));
  const address = instance.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address.");
  return `http://127.0.0.1:${address.port}/v1/`;
}
const literal = (content: string) => ({ type: "text", text: { content } });
const metadata = (id: string) => ({ id, properties: { Name: { type: "title", title: [literal(`Page ${id}`)] } } });
function parsed(value: CallToolResult) {
  const content = value.content[0];
  if (content.type !== "text") throw new Error("Expected text.");
  expect(Buffer.byteLength(content.text)).toBeLessThanOrEqual(8000);
  return JSON.parse(content.text) as { items: { id: string; text: string; truncated?: boolean }[]; next_cursor: string | null };
}

describe("Notion backend", () => {
  it("searches only allowed page metadata and denies alternate UUID forms of forbidden pages", async () => {
    const paths: string[] = [];
    const baseUrl = await server((req, res) => { paths.push(req.url ?? ""); expect(req.headers.authorization).toBe("Bearer secret"); expect(req.headers["notion-version"]).toBe("2026-03-11"); res.end(JSON.stringify(metadata(page))); });
    const backend = createNotionBackend({ token: "secret", baseUrl });
    const result = await backend.callTool(ctx, "search_pages", { query: "Page" });
    expect(parsed(result).items).toHaveLength(1);
    expect(paths).toEqual([`/v1/pages/${page}`]);
    const denied = await backend.callTool(ctx, "read_page", { page: "99999999-9999-9999-9999-999999999999" });
    expect(denied.isError).toBe(true);
    expect(paths).toHaveLength(1);
  });

  it("paginates opaque block cursors after the last returned item and clips safely", async () => {
    const baseUrl = await server((req, res) => {
      const url = new URL(req.url ?? "", "http://fixture");
      if (url.pathname.startsWith("/v1/pages/")) { res.end(JSON.stringify(metadata(page))); return; }
      expect(url.searchParams.get("page_size")).toBe("1");
      const index = Number((url.searchParams.get("start_cursor") ?? "cursor:0").split(":")[1]);
      const id = String(index).padStart(32, "0");
      res.end(JSON.stringify({ results: [{ id, type: "paragraph", paragraph: { rich_text: [literal('名"\n'.repeat(5000)), { type: "mention", plain_text: "private title", mention: { page: { id: forbidden } } }] } }], has_more: index < 14, next_cursor: index < 14 ? `cursor:${index + 1}` : null }));
    });
    const backend = createNotionBackend({ token: "secret", baseUrl });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const result = await backend.callTool(ctx, "read_page", { page, limit: 50, ...(cursor ? { cursor } : {}) });
      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result)).not.toContain("private title");
      const data = parsed(result);
      expect(data.items.every((item) => item.truncated === true)).toBe(true);
      seen.push(...data.items.map((item) => item.id));
      cursor = data.next_cursor;
    } while (cursor);
    expect(seen).toEqual(Array.from({ length: 15 }, (_, index) => String(index).padStart(32, "0")));
  });

  it("never follows or exposes child pages, linked pages, or synced blocks", async () => {
    const paths: string[] = [];
    const baseUrl = await server((req, res) => {
      paths.push(req.url ?? "");
      if (req.url?.startsWith("/v1/pages/")) res.end(JSON.stringify(metadata(page)));
      else res.end(JSON.stringify({ results: [{ id: forbidden, type: "child_page", child_page: { title: "private title" } }], has_more: false, next_cursor: null }));
    });
    const result = await createNotionBackend({ token: "secret", baseUrl }).callTool(ctx, "read_page", { page });
    expect(parsed(result).items).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/private title|99999999/);
    expect(paths).toHaveLength(2);
  });

  it("search paginates the allowlist without global search or duplicates", async () => {
    const ids = Array.from({ length: 17 }, (_, index) => String(index).padStart(32, "0"));
    const baseUrl = await server((req, res) => { expect(req.url).toMatch(/^\/v1\/pages\/[0-9]{32}$/); res.end(JSON.stringify(metadata((req.url ?? "").split("/").at(-1) ?? ""))); });
    const backend = createNotionBackend({ token: "secret", baseUrl });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const value = parsed(await backend.callTool({ ...ctx, allowedResources: { page: ids } }, "search_pages", { query: "Page", limit: 3, ...(cursor ? { cursor } : {}) }));
      seen.push(...value.items.map((item) => item.id)); cursor = value.next_cursor;
    } while (cursor);
    expect(seen).toEqual(ids);
  });

  it("maps returned canonical page IDs to equivalent dashed gateway permissions", async () => {
    const baseUrl = await server((req, res) => {
      res.end(JSON.stringify(req.url?.startsWith("/v1/pages/") ? metadata(page) : { results: [], has_more: false, next_cursor: null }));
    });
    const backend = createNotionBackend({ token: "secret", baseUrl });
    const permissionCtx = { ...ctx, allowedResources: { page: ["11111111-1111-1111-1111-111111111111"] } };
    const search = await executeToolCall(backend, permissionCtx, "search_pages", { query: "Page" });
    const returned = parsed(search.result).items[0].id;
    const read = await executeToolCall(backend, permissionCtx, "read_page", { page: returned });
    expect(read.outcome).toBe("ok");
    expect(read.resourceId).toBe("11111111-1111-1111-1111-111111111111");
    expect((await executeToolCall(backend, permissionCtx, "read_page", { page: forbidden })).outcome).toBe("denied");
  });

  it("denies searches without permitted pages before invoking the backend", async () => {
    let calls = 0;
    const backend = createNotionBackend({ token: "secret" });
    const observed = { ...backend, callTool: async () => { calls++; return { content: [] }; } };
    const result = await executeToolCall(observed, { ...ctx, allowedResources: {} }, "search_pages", { query: "Page" });
    expect(result.outcome).toBe("denied");
    expect(result.reason).toBe("no_resources_allowed");
    expect(result.result.isError).toBe(true);
    expect(result.resourceType).toBe("page");
    expect(calls).toBe(0);
  });

  it("preserves the empty-success default for other search tools", async () => {
    let calls = 0;
    const observed = { ...echoBackend, callTool: async () => { calls++; return { content: [] }; } };
    const result = await executeToolCall(observed, { ...ctx, server: "echo", allowedResources: {} }, "echo_search", { query: "Page" });
    expect(result.outcome).toBe("ok");
    expect(result.result).toEqual({ content: [] });
    expect(result.resourceCount).toBe(0);
    expect(calls).toBe(0);
  });

  it("rejects invalid arguments and sanitizes upstream errors", async () => {
    let calls = 0;
    const baseUrl = await server((_req, res) => { calls++; res.writeHead(403); res.end("secret credential"); });
    const backend = createNotionBackend({ token: "secret", baseUrl });
    expect((await backend.callTool(ctx, "search_pages", { query: 1 })).isError).toBe(true);
    expect(calls).toBe(0);
    const result = await backend.callTool(ctx, "read_page", { page });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/secret|credential/);
  });
});
