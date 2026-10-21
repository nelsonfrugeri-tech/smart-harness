import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { echoBackend } from "../src/backends/echo.ts";
import { ACTIVE_GATEWAY_TOKEN_SQL } from "../src/db/access.ts";
import { hashGatewayToken } from "../src/domain/gateway-token.ts";
import {
  connectClient,
  countingBackend,
  createFixture,
  DEV,
  DEV_CARTOES,
  type CountingBackend,
  type Fixture,
} from "./test-support.ts";

const INITIALIZE_BODY = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "raw", version: "0" } },
};
const MCP_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };

function textOf(result: unknown): string {
  const content = (result as { content: { type: string; text?: string }[] }).content;
  return content.map((part) => part.text ?? "").join("");
}

describe("MCP endpoint", () => {
  let fixture: Fixture;
  let github: CountingBackend;
  let devToken: string;
  const clients: Client[] = [];

  beforeAll(async () => {
    github = countingBackend("github");
    fixture = await createFixture({ backends: [echoBackend, github], allowedOrigins: ["https://ok.example"] });
    devToken = fixture.token(DEV);
  });
  afterAll(async () => {
    await Promise.all(clients.map((client) => client.close()));
    await fixture.close();
  });

  async function connect(project: string, server: string, token = devToken): Promise<Client> {
    const client = await connectClient(fixture.mcpUrl(project, server), token);
    clients.push(client);
    return client;
  }

  function post(project: string, server: string, headers: Record<string, string>, body: unknown = INITIALIZE_BODY) {
    return fetch(fixture.mcpUrl(project, server), { method: "POST", headers: { ...MCP_HEADERS, ...headers }, body: JSON.stringify(body) });
  }

  it("lets a client with the developer's token initialize, list and call the echo tools", async () => {
    const client = await connect("investimentos-api", "echo");

    const tools = await client.listTools();
    const result = await client.callTool({ name: "echo_message", arguments: { item: "demo-item", message: "hello" } });

    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(["echo_message", "echo_search"]);
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toBe("echo: hello");
    expect(client.getServerVersion()?.name).toBe("smart-harness-gateway-echo");
  });

  it("answers 401 with WWW-Authenticate when the token is missing, malformed or unknown", async () => {
    const unknownToken = `shg_${"A".repeat(43)}`;
    const cases: Record<string, string>[] = [{}, { authorization: "Bearer not-a-token" }, { authorization: `Bearer ${unknownToken}` }];
    for (const headers of cases) {
      const response = await post("investimentos-api", "echo", headers);

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe("Bearer");
    }
  });

  it("answers 401 for a revoked token and for an expired token", async () => {
    const revoked = fixture.token(DEV_CARTOES);
    fixture.revokeAll(DEV_CARTOES);
    const expired = `shg_${"B".repeat(43)}`;
    fixture.apiDb
      .prepare(
        `INSERT INTO gateway_tokens (id, user_id, name, token_hash, created_at, expires_at)
         VALUES ('expired-token', (SELECT id FROM users WHERE email = ?), 'old', ?, '2020-01-01T00:00:00.000Z', '2020-02-01T00:00:00.000Z')`,
      )
      .run(DEV, hashGatewayToken(expired));

    const revokedResponse = await post("cartoes-app", "echo", { authorization: `Bearer ${revoked}` });
    const expiredResponse = await post("investimentos-api", "echo", { authorization: `Bearer ${expired}` });

    expect(revokedResponse.status).toBe(401);
    expect(expiredResponse.status).toBe(401);
  });

  it("answers 404 for a project of another squad and audits it as denied", async () => {
    const before = fixture.auditRows().length;

    const response = await post("cartoes-app", "echo", { authorization: `Bearer ${devToken}` });

    expect(response.status).toBe(404);
    const rows = fixture.auditRows().slice(before);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("gateway.access_denied");
    expect(JSON.parse(rows[0]?.details ?? "{}")).toMatchObject({ project: "cartoes-app", reason: "project_not_found" });
  });

  it("answers 404 for an unknown project and for an unregistered server", async () => {
    const unknownProject = await post("no-such-project", "echo", { authorization: `Bearer ${devToken}` });
    const unknownServer = await post("investimentos-api", "trello", { authorization: `Bearer ${devToken}` });

    expect(unknownProject.status).toBe(404);
    expect(unknownServer.status).toBe(404);
  });

  it("answers 403 for a foreign Origin before looking at the token, and accepts an allowed Origin", async () => {
    const foreign = await post("investimentos-api", "echo", { origin: "https://evil.example", authorization: `Bearer ${devToken}` });
    const foreignWithoutToken = await post("investimentos-api", "echo", { origin: "https://evil.example" });
    const allowed = await post("investimentos-api", "echo", { origin: "https://ok.example", authorization: `Bearer ${devToken}` });

    expect(foreign.status).toBe(403);
    expect(foreignWithoutToken.status).toBe(403);
    expect(allowed.status).toBe(200);
  });

  it("answers 405 to GET and DELETE", async () => {
    for (const method of ["GET", "DELETE"]) {
      const response = await fetch(fixture.mcpUrl("investimentos-api", "echo"), { method, headers: { authorization: `Bearer ${devToken}` } });

      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
    }
  });

  it("denies a resource of another project of the same squad without calling the backend", async () => {
    const client = await connect("investimentos-api", "github");
    github.calls.length = 0;
    const before = fixture.auditRows().length;

    const allowed = await client.callTool({ name: "get_repo", arguments: { repo: "acme-fake/investimentos-api" } });
    const otherProject = await client.callTool({ name: "get_repo", arguments: { repo: "acme-fake/investimentos-web" } });
    const missing = await client.callTool({ name: "get_repo", arguments: {} });

    expect(allowed.isError).not.toBe(true);
    expect(otherProject.isError).toBe(true);
    expect(missing.isError).toBe(true);
    expect(github.calls.map((call) => call.args.repo)).toEqual(["acme-fake/investimentos-api"]);
    const details = fixture.auditRows().slice(before).map((row) => JSON.parse(row.details));
    expect(details.map((d) => [d.outcome, d.reason, d.resource_id])).toEqual([
      ["ok", null, "acme-fake/investimentos-api"],
      ["denied", "resource_not_allowed", "acme-fake/investimentos-web"],
      ["denied", "resource_not_identified", null],
    ]);
  });

  it("gives a search tool only the project's allowed resources", async () => {
    const client = await connect("investimentos-web", "github");
    github.calls.length = 0;

    const result = await client.callTool({ name: "search_code", arguments: { query: "x" } });

    expect(JSON.parse(textOf(result))).toEqual({ searched: ["acme-fake/investimentos-web"] });
  });

  it("denies a search tool and skips the backend when the project has no resources", async () => {
    const client = await connect("conta-digital", "github");
    github.calls.length = 0;
    const before = fixture.auditRows().length;

    const result = await client.callTool({ name: "search_code", arguments: { query: "x" } });

    expect(result.isError).toBe(true);
    expect(github.calls).toHaveLength(0);
    const details = JSON.parse(fixture.auditRows().slice(before)[0]?.details ?? "{}");
    expect(details).toMatchObject({ outcome: "denied", reason: "no_allowed_resources", resource_type: "repo" });
  });

  it("hides a tool that declares no resource and denies calling it", async () => {
    const client = await connect("investimentos-api", "github");
    github.calls.length = 0;

    const tools = await client.listTools();
    const result = await client.callTool({ name: "undeclared_tool", arguments: {} });
    const unknown = await client.callTool({ name: "no_such_tool", arguments: {} });

    expect(tools.tools.map((tool) => tool.name)).not.toContain("undeclared_tool");
    expect(result.isError).toBe(true);
    expect(unknown.isError).toBe(true);
    expect(github.calls).toHaveLength(0);
  });

  it("reports a backend failure as an error result without leaking its message", async () => {
    const client = await connect("investimentos-api", "github");
    const before = fixture.auditRows().length;

    const result = await client.callTool({ name: "broken_tool", arguments: { repo: "acme-fake/investimentos-api" } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).not.toContain("secret-in-error");
    const rows = fixture.auditRows().slice(before);
    expect(JSON.parse(rows[0]?.details ?? "{}")).toMatchObject({ outcome: "error", reason: "backend_error" });
    expect(rows[0]?.details).not.toContain("secret-in-error");
  });

  it("never stores argument values in the audit trail, only the resource id", async () => {
    const client = await connect("investimentos-api", "echo");
    const before = fixture.auditRows().length;

    await client.callTool({ name: "echo_message", arguments: { item: "demo-item", message: "PAYLOAD-VALUE-9f3a" } });
    await client.callTool({ name: "echo_message", arguments: { item: "other-item", message: "PAYLOAD-VALUE-9f3a" } });
    await client.callTool({ name: "echo_search", arguments: { query: "PAYLOAD-VALUE-9f3a" } });

    const rows = fixture.auditRows().slice(before);
    expect(rows).toHaveLength(3);
    expect(JSON.stringify(rows)).not.toContain("PAYLOAD-VALUE-9f3a");
    expect(rows.map((row) => JSON.parse(row.details).outcome)).toEqual(["ok", "denied", "ok"]);
    expect(rows[0]).toMatchObject({ action: "gateway.tool_call", tenant_id: expect.any(String), actor_user_id: expect.any(String) });
  });
});

describe("MCP endpoint with an unavailable tool catalog", () => {
  const SENTINEL = "CATALOG-ERROR-SENTINEL";
  let fixture: Fixture;
  let calls: string[];

  beforeAll(async () => {
    calls = [];
    const failingCatalog = {
      server: "github",
      listTools(): never {
        throw new Error(SENTINEL);
      },
      async callTool() {
        calls.push("callTool");
        return { content: [] };
      },
    };
    fixture = await createFixture({ backends: [failingCatalog] });
  });
  afterAll(async () => {
    await fixture.close();
  });

  function rpc(body: unknown) {
    return fetch(fixture.mcpUrl("investimentos-api", "github"), {
      method: "POST",
      headers: { ...MCP_HEADERS, authorization: `Bearer ${fixture.token(DEV)}` },
      body: JSON.stringify(body),
    });
  }

  it("audits exactly one generic error for tools/call and never runs the tool", async () => {
    const before = fixture.auditRows().length;

    const response = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_repo", arguments: { repo: "acme-fake/investimentos-api" } },
    });
    const text = await response.text();

    expect(text).not.toContain(SENTINEL);
    expect(calls).toHaveLength(0);
    const rows = fixture.auditRows().slice(before);
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]?.details ?? "{}")).toMatchObject({ outcome: "error", reason: "catalog_unavailable" });
    expect(rows[0]?.details).not.toContain(SENTINEL);
  });

  it("answers tools/list with a generic error", async () => {
    const response = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const text = await response.text();

    expect(text).not.toContain(SENTINEL);
    expect(text).toContain("error");
  });
});

describe("token rule shared with the API", () => {
  it("uses the same SQL text as ACTIVE_GATEWAY_TOKEN_SQL in the control plane", () => {
    const source = readFileSync(new URL("../../control-plane/src/db/repos/gateway-tokens.ts", import.meta.url), "utf8");
    const now = /const NOW = "([^"]+)"/.exec(source)?.[1] ?? "";
    const apiSql = /ACTIVE_GATEWAY_TOKEN_SQL = `([^`]+)`/.exec(source)?.[1]?.replace("${NOW}", now) ?? "";
    const squash = (sql: string) => sql.replace(/\s+/g, " ").trim();

    expect(apiSql).not.toBe("");
    expect(squash(ACTIVE_GATEWAY_TOKEN_SQL)).toBe(squash(apiSql));
  });
});
