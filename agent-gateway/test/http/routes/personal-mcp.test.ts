import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolContext } from "../../../src/mcp/backend.ts";
import { connectClient, countingBackend, createFixture, DEV, type CountingBackend, type Fixture } from "../../test-support.ts";

describe("personal MCP authorization", () => {
  let fixture: Fixture;
  let backend: CountingBackend;
  let token: string;
  const contexts: ToolContext[] = [];
  const url = () => `${fixture.baseUrl}/mcp/me/github`;
  beforeEach(async () => {
    backend = countingBackend();
    const original = backend.callTool;
    backend.callTool = async (ctx, name, args) => { contexts.push(ctx); return original(ctx, name, args); };
    fixture = await createFixture({ backends: [backend, countingBackend("project")] });
    token = fixture.token(DEV);
    contexts.length = 0;
    fixture.apiDb.prepare(`INSERT INTO user_gateway_permissions (user_id, tenant_id, server, resource_type, resource_id)
      SELECT u.id, t.id, 'github', 'repo', 'demo/personal' FROM users u, tenants t
      WHERE u.email = ? AND t.slug = 'investimentos'`).run(DEV);
  });
  afterEach(async () => fixture.close());

  it("uses personal grants and carries no fake project", async () => {
    const client = await connectClient(url(), token);
    try {
      const result = await client.callTool({ name: "get_repo", arguments: { repo: "demo/personal" } });
      expect(result.isError).not.toBe(true);
      expect(contexts[0]).toMatchObject({ scope: "personal", server: "github" });
      expect(contexts[0]).not.toHaveProperty("project");
      expect(fixture.auditRows().at(-1)).toMatchObject({ action: "gateway.tool_call", tenant_id: null });
      const details = JSON.parse(fixture.auditRows().at(-1)?.details ?? "{}");
      expect(details.scope).toBe("personal");
      expect(details).not.toHaveProperty("project");
    } finally { await client.close(); }
  });

  it("does not inherit project resources or another user's grants", async () => {
    const client = await connectClient(url(), token);
    const other = await connectClient(url(), fixture.token("admin@smart-harness.local"));
    try {
      expect((await client.callTool({ name: "get_repo", arguments: { repo: "acme-fake/investimentos-api" } })).isError).toBe(true);
      expect((await other.callTool({ name: "get_repo", arguments: { repo: "demo/personal", user_id: (fixture.apiDb.prepare("SELECT id FROM users WHERE email = ?").get(DEV) as { id: string }).id } })).isError).toBe(true);
      expect((await other.callTool({ name: "search_code", arguments: {} })).isError).toBe(true);
      expect((await client.callTool({ name: "undeclared_tool", arguments: {} })).isError).toBe(true);
      expect(backend.calls).toEqual([]);
    } finally { await client.close(); await other.close(); }
  });

  it("rechecks membership on every request, including an already connected client", async () => {
    const client = await connectClient(url(), token);
    try {
      expect((await client.callTool({ name: "get_repo", arguments: { repo: "demo/personal" } })).isError).not.toBe(true);
      fixture.apiDb.prepare("DELETE FROM memberships WHERE user_id = (SELECT id FROM users WHERE email = ?) AND tenant_id = (SELECT id FROM tenants WHERE slug = 'investimentos')").run(DEV);
      expect((await client.callTool({ name: "get_repo", arguments: { repo: "demo/personal" } })).isError).toBe(true);
      expect(backend.calls).toHaveLength(1);
    } finally { await client.close(); }
  });

  it("fails closed when grants exceed the bounded authorization set", async () => {
    const grant = fixture.apiDb.prepare(`INSERT INTO user_gateway_permissions (user_id, tenant_id, server, resource_type, resource_id)
      SELECT u.id, t.id, 'github', 'repo', ? FROM users u, tenants t
      WHERE u.email = ? AND t.slug = 'investimentos'`);
    fixture.apiDb.transaction(() => {
      for (let index = 0; index < 1000; index += 1) grant.run(`demo/repo-${index}`, DEV);
    })();
    const client = await connectClient(url(), token);
    try {
      expect((await client.callTool({ name: "search_code", arguments: {} })).isError).toBe(true);
      expect(backend.calls).toEqual([]);
    } finally { await client.close(); }
  });

  it("rejects revoked or absent tokens, client identity overrides and project-only servers", async () => {
    const post = (path: string, authorization?: string) => fixture.app.inject({ method: "POST", url: path,
      headers: authorization ? { authorization: `Bearer ${authorization}` } : {}, payload: {} });
    expect((await post("/mcp/me/github")).statusCode).toBe(401);
    expect((await post("/mcp/me/github?user_id=someone-else", token)).statusCode).toBe(400);
    expect((await post("/mcp/me/project", token)).statusCode).toBe(404);
    fixture.revokeAll(DEV);
    expect((await post("/mcp/me/github", token)).statusCode).toBe(401);
  });
});
