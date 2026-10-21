import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createTrelloBackend } from "../../src/backends/trello/index.ts";
import type { ToolContext } from "../../src/mcp/backend.ts";

const ctx: ToolContext = { userId: "u", project: { id: "p", slug: "p", tenantId: "t" }, server: "trello", correlationId: "c", allowedResources: { board: ["allowed"] } };
const close: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of close.splice(0)) await cleanup(); });
async function server(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const instance = createServer(handler);
  await new Promise<void>((resolve, reject) => { instance.once("error", reject); instance.listen(0, "127.0.0.1", resolve); });
  close.push(() => new Promise<void>((resolve, reject) => instance.close((error) => error ? reject(error) : resolve())));
  const address = instance.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address.");
  return `http://127.0.0.1:${address.port}/1/`;
}
function parsed(value: Awaited<ReturnType<ReturnType<typeof createTrelloBackend>["callTool"]>>) {
  const content = value.content[0];
  if (content.type !== "text") throw new Error("Expected text.");
  return JSON.parse(content.text) as { items: { id: string; truncated?: boolean }[]; next_cursor: string | null };
}

describe("Trello backend", () => {
  it("uses header credentials and paginates long board cards without skipped items", async () => {
    const baseUrl = await server((req, res) => {
      expect(req.headers.authorization).toBe('OAuth oauth_consumer_key="key", oauth_token="secret"');
      expect(req.url).not.toMatch(/key=|token=|secret/);
      res.setHeader("content-type", "application/json");
      const url = new URL(req.url ?? "", "http://fixture");
      const before = url.searchParams.get("before");
      const cards = Array.from({ length: 16 }, (_, index) => ({ id: String(index).padStart(3, "0"), idBoard: "allowed", name: "名".repeat(1000), desc: '"\n'.repeat(4000) })).reverse();
      res.end(JSON.stringify(cards.filter((item) => before === null || item.id < before).slice(0, Number(url.searchParams.get("limit")))));
    });
    const backend = createTrelloBackend({ apiKey: "key", token: "secret", baseUrl });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const result = await backend.callTool(ctx, "list_cards", { board: "allowed", limit: 50, ...(cursor ? { cursor } : {}) });
      expect(result.isError).not.toBe(true);
      const content = result.content[0];
      expect(content.type === "text" && Buffer.byteLength(content.text)).toBeLessThanOrEqual(8000);
      const data = parsed(result);
      expect(data.items.every((item) => item.truncated === true)).toBe(true);
      seen.push(...data.items.map((item) => item.id));
      cursor = data.next_cursor;
    } while (cursor);
    expect(seen).toEqual(Array.from({ length: 16 }, (_, index) => String(index).padStart(3, "0")).reverse());
  });

  it("paginates more than 1000 cards through the upstream before cursor", async () => {
    const ids = Array.from({ length: 1105 }, (_, index) => index.toString(16).padStart(24, "0")).reverse();
    const requests: URL[] = [];
    const baseUrl = await server((req, res) => {
      const url = new URL(req.url ?? "", "http://fixture");
      requests.push(url);
      const before = url.searchParams.get("before");
      const count = Math.min(Number(url.searchParams.get("limit") ?? 1000), 1000);
      const remaining = ids.filter((id) => before === null || id < before);
      res.end(JSON.stringify(remaining.slice(0, count).map((id) => ({ id, idBoard: "allowed", name: "Card", desc: "Description" }))));
    });
    const backend = createTrelloBackend({ apiKey: "key", token: "secret", baseUrl });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const value = parsed(await backend.callTool(ctx, "list_cards", { board: "allowed", limit: 50, ...(cursor ? { cursor } : {}) }));
      seen.push(...value.items.map((item) => item.id));
      cursor = value.next_cursor;
    } while (cursor);
    expect(seen).toHaveLength(1105);
    expect(seen).toEqual(ids);
    expect(requests.length).toBeGreaterThan(1);
    expect(requests.every((request) => request.searchParams.get("sort") === "-id")).toBe(true);
    expect(requests.every((request) => request.searchParams.get("limit") === "51")).toBe(true);
    expect(requests.slice(1).every((request) => request.searchParams.has("before"))).toBe(true);
  });

  it("rejects forbidden boards before HTTP and foreign cards without content leaks", async () => {
    const paths: string[] = [];
    const baseUrl = await server((req, res) => { paths.push(req.url ?? ""); res.end(JSON.stringify({ id: "card", idBoard: "forbidden", name: "private title", desc: "private data" })); });
    const backend = createTrelloBackend({ apiKey: "key", token: "secret", baseUrl });
    expect((await backend.callTool(ctx, "list_cards", { board: "forbidden" })).isError).toBe(true);
    expect(paths).toHaveLength(0);
    const denied = await backend.callTool(ctx, "get_card", { board: "allowed", card: "card" });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied)).not.toMatch(/private|forbidden|secret/);
  });

  it("sanitizes upstream failures and validates tool arguments", async () => {
    let calls = 0;
    const baseUrl = await server((_req, res) => { calls++; res.writeHead(401); res.end("secret credential failure"); });
    const backend = createTrelloBackend({ apiKey: "key", token: "secret", baseUrl });
    expect((await backend.callTool(ctx, "list_cards", { board: "allowed", limit: -1 })).isError).toBe(true);
    expect(calls).toBe(0);
    const result = await backend.callTool(ctx, "list_cards", { board: "allowed" });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/secret|credential/);
  });

  it("does not follow redirects carrying server credentials", async () => {
    let received = 0;
    const target = await server((_req, res) => { received++; res.end("private"); });
    const baseUrl = await server((_req, res) => { res.writeHead(302, { location: target }); res.end(); });
    const backend = createTrelloBackend({ apiKey: "key", token: "secret", baseUrl });
    const response = await backend.callTool(ctx, "list_cards", { board: "allowed" });
    expect(response.isError).toBe(true);
    expect(received).toBe(0);
  });

  it("reads a permitted card with its identifiable source", async () => {
    const baseUrl = await server((_req, res) => res.end(JSON.stringify({ id: "card", idBoard: "allowed", name: "Card", desc: "Description" })));
    const result = await createTrelloBackend({ apiKey: "key", token: "secret", baseUrl }).callTool(ctx, "get_card", { board: "allowed", card: "card" });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result)).toContain("https://trello.com/c/card");
  });
});
