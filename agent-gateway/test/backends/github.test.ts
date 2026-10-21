import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/mcp/backend.ts";
import { createGithubBackend } from "../../src/backends/github/index.ts";

const token = "github-fixture-secret";
const ctx: ToolContext = {
  userId: "user", project: { id: "project", slug: "project", tenantId: "tenant" },
  server: "github", correlationId: "correlation", allowedResources: { repo: ["org/allowed"] },
};
const resourceSchema = {
  type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, path: { type: "string" } },
  required: ["owner", "repo"],
};
const tools = [
  { name: "get_file_contents", inputSchema: resourceSchema },
  { name: "issue_read", inputSchema: { ...resourceSchema, properties: { ...resourceSchema.properties, method: { type: "string" }, issue_number: { type: "number" } } } },
  ...["search_code", "search_commits", "search_issues", "search_pull_requests", "search_repositories"].map((name) => ({
    name, inputSchema: { type: "object", properties: { query: { type: "string" }, perPage: { type: "number" }, page: { type: "number" } }, required: ["query"] },
  })),
  { name: "create_issue", inputSchema: resourceSchema },
  { name: "get_me", inputSchema: { type: "object" } },
];
let calls: Record<string, unknown>[] = [];
let headers: string[] = [];
let responseText = "fixture result";
let failure = false;
const connections: Server[] = [];
const http = createServer(async (req, res) => {
  headers.push(req.headers.authorization ?? "");
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const server = new Server({ name: "github-fixture", version: "1" }, { capabilities: { tools: {} } });
  connections.push(server);
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, (request) => {
    calls.push(request.params);
    if (failure) throw new Error(token);
    return { content: [{ type: "text", text: responseText }] };
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  await transport.handleRequest(req, res, chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined);
});
let url: string;
beforeAll(async () => {
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
});
afterAll(async () => {
  await Promise.all(connections.map((connection) => connection.close()));
  await new Promise<void>((resolve) => http.close(() => resolve()));
});
beforeEach(() => { calls = []; headers = []; responseText = "fixture result"; failure = false; });

describe("GitHub remote MCP backend", () => {
  it("validates the factory boundary without exposing credentials", () => {
    expect(() => createGithubBackend({ token: "" })).toThrow("GitHub backend configuration is invalid.");
    expect(() => createGithubBackend({ token, url: "https://example.com/mcp" })).toThrow("GitHub backend configuration is invalid.");
  });
  it("exposes only declared repository reads and scoped searches", async () => {
    const catalog = await createGithubBackend({ token, url }).listTools(ctx);
    expect(catalog.map((tool) => tool.name).sort()).toEqual([
      "get_file_contents", "issue_read", "search_code", "search_commits", "search_issues", "search_pull_requests",
    ]);
    expect(catalog.find((tool) => tool.name === "get_file_contents")?.access).toMatchObject({ kind: "resource", resourceType: "repo" });
    expect(headers.every((header) => header === `Bearer ${token}`)).toBe(true);
  });
  it("reads an allowed repository through the SDK", async () => {
    const result = await createGithubBackend({ token, url }).callTool(ctx, "get_file_contents", { owner: "org", repo: "allowed", path: "README.md" });
    expect(result).toMatchObject({ content: [{ type: "text", text: responseText }] });
    expect(calls).toHaveLength(1);
  });
  it.each([
    ["get_file_contents", { owner: "org", repo: "denied" }],
    ["get_file_contents", { owner: "org", repo: "allowed", url: "https://evil.test" }],
    ["create_issue", { owner: "org", repo: "allowed" }],
    ["issue_read", { owner: "org", repo: "allowed", method: "create", issue_number: 1 }],
    ...["error", "repo:org/allowed OR secret", "repo:org/allowed repo:org/denied", "-repo:org/allowed secret", "repo:org/allowed /secret.*/", "repo:org/allowed (secret)", 'repo:org/allowed "repo:org/denied"', "repo:org/allowed NOT error", "repo:org/allowed org:denied", "repo:org/allowed user:denied"].map((query): [string, Record<string, unknown>] => ["search_code", { query }]),
  ])("rejects unauthorized or ambiguous %s before an upstream call", async (name, args) => {
    const result = await createGithubBackend({ token, url }).callTool(ctx, name as string, args as Record<string, unknown>);
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
  it.each(["search_code", "search_commits", "search_issues", "search_pull_requests"])("scopes %s to an allowed repository", async (name) => {
    const result = await createGithubBackend({ token, url }).callTool(ctx, name, { query: "repo:org/allowed error", perPage: 1, page: 2 });
    expect(result.isError).not.toBe(true);
    expect(calls[0]).toMatchObject({ name, arguments: { query: "repo:org/allowed error", perPage: 1, page: 2 } });
  });
  it("drops errors and credential-bearing results", async () => {
    const backend = createGithubBackend({ token, url });
    failure = true;
    const failed = await backend.callTool(ctx, "get_file_contents", { owner: "org", repo: "allowed" });
    expect(failed.isError).toBe(true);
    expect(JSON.stringify(failed)).not.toContain(token);
    failure = false;
    responseText = token;
    const leaked = await backend.callTool(ctx, "get_file_contents", { owner: "org", repo: "allowed" });
    expect(leaked.isError).toBe(true);
    expect(JSON.stringify(leaked)).not.toContain(token);
  });
  it("continues a large list after the last delivered item without losing identifiers", async () => {
    responseText = JSON.stringify({ items: Array.from({ length: 100 }, (_, id) => ({ id, body: "x".repeat(1000) })), total_count: 100 });
    const backend = createGithubBackend({ token, url });
    const ids: number[] = [];
    let cursor: string | undefined;
    do {
      const result = await backend.callTool(ctx, "search_issues", { query: "repo:org/allowed error", ...(cursor ? { harnessCursor: cursor } : {}) });
      expect(JSON.stringify(result).length).toBeLessThanOrEqual(8000);
      expect(result.isError).not.toBe(true);
      const text = result.content[0];
      if (text.type !== "text") throw new Error("Expected JSON text");
      const page = JSON.parse(text.text);
      ids.push(...page.items.map((item: { id: number }) => item.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(ids).toEqual(Array.from({ length: 100 }, (_, id) => id));
  });
  it("rejects a continuation if the upstream page changed or the query changed", async () => {
    responseText = JSON.stringify({ items: Array.from({ length: 100 }, (_, id) => ({ id, body: "x".repeat(1000) })) });
    const backend = createGithubBackend({ token, url });
    const first = await backend.callTool(ctx, "search_issues", { query: "repo:org/allowed error" });
    if (first.content[0].type !== "text") throw new Error("Expected text");
    const harnessCursor = JSON.parse(first.content[0].text).nextCursor;
    const changedQuery = await backend.callTool(ctx, "search_issues", { query: "repo:org/allowed other", harnessCursor });
    expect(changedQuery.isError).toBe(true);
    responseText = JSON.stringify({ items: [{ id: 100 }] });
    const changed = await backend.callTool(ctx, "search_issues", { query: "repo:org/allowed error", harnessCursor });
    expect(changed.isError).toBe(true);
    expect(JSON.stringify(changed)).toContain("upstream_page_changed");
  });
  it("preserves a usable long source URL in a large object preview", async () => {
    const source = `https://github.com/org/allowed/blob/main/${"long-directory/".repeat(45)}README.md`;
    responseText = JSON.stringify({ id: 14, html_url: source, fields: Array.from({ length: 500 }, () => "body".repeat(200)) });
    const result = await createGithubBackend({ token, url }).callTool(ctx, "get_file_contents", { owner: "org", repo: "allowed" });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(8000);
    if (result.content[0].type !== "text") throw new Error("Expected JSON text");
    expect(JSON.parse(result.content[0].text)).toMatchObject({ data: { id: 14, html_url: source }, truncated: true });
  });
  it("compacts a singular object while preserving identity and valid bounded JSON", async () => {
    responseText = JSON.stringify({ id: 14, html_url: "https://github.com/org/allowed/issues/14", body: '\\"'.repeat(20000) });
    const result = await createGithubBackend({ token, url }).callTool(ctx, "get_file_contents", { owner: "org", repo: "allowed" });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(8000);
    const text = result.content[0];
    if (text.type !== "text") throw new Error("Expected JSON text");
    expect(JSON.parse(text.text)).toMatchObject({ data: { id: 14 }, truncated: true });
  });
});
