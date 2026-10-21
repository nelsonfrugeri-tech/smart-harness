import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { githubBackend, repoOfQuery } from "../../src/backends/github.ts";
import { MAX_RESPONSE_CHARS } from "../../src/mcp/limits.ts";
import { connectClient, createFixture, DEV, type Fixture } from "../test-support.ts";
import { startFakeMcp, type FakeMcp } from "./fakes.ts";

const TOKEN = "ghp_FAKE_SERVICE_TOKEN_0123456789";
const ALLOWED = "acme/investimentos-api";

function textOf(result: unknown): string {
  return (result as { content: { text?: string }[] }).content.map((part) => part.text ?? "").join("");
}

describe("repoOfQuery", () => {
  const cases: [string, string | null][] = [
    ["repo:acme/investimentos-api handler", ALLOWED],
    ["handler repo:Acme/Investimentos-API", ALLOWED],
    ['"repo:other/x" repo:acme/investimentos-api', ALLOWED],
    ["handler", null],
    ["", null],
    ["repo:acme/a repo:acme/b", null],
    ["repo:acme/a OR repo:acme/b", null],
    ["repo:acme/a org:acme", null],
    ["repo:acme/a user:someone", null],
    ["org:acme handler", null],
    ["-repo:acme/b repo:acme/a", null],
    ["(repo:acme/a)", null],
    ["repo:acme/a NOT is:open", null],
    ["repo:acme", null],
    ['repo:"acme/a"', null],
    ['unbalanced " repo:acme/a', null],
  ];
  for (const [query, expected] of cases) {
    it(`reads ${JSON.stringify(query)} as ${JSON.stringify(expected)}`, () => {
      expect(repoOfQuery(query)).toBe(expected);
    });
  }
  it("rejects a query that is not a string", () => {
    expect(repoOfQuery(undefined)).toBeNull();
    expect(repoOfQuery(42)).toBeNull();
  });
});

describe("github backend through the gateway", () => {
  let upstream: FakeMcp;
  let fixture: Fixture;
  let client: Client;
  const logs: string[] = [];

  beforeAll(async () => {
    upstream = await startFakeMcp({
      // Like the real server: a text note plus an embedded resource with the file text.
      get_file_contents: (args) => ({
        content: [
          { type: "text", text: "successfully downloaded text file" },
          {
            type: "resource",
            resource: { uri: `repo://${String(args.owner)}/${String(args.repo)}/${String(args.path)}`, mimeType: "text/plain", text: `file ${String(args.path)} of ${String(args.owner)}/${String(args.repo)}` },
          },
        ],
      }),
      search_code: (args) => ({ content: [{ type: "text", text: JSON.stringify({ query: args.query, total: 1 }) }] }),
      list_commits: () => ({ content: [{ type: "text", text: "x".repeat(20_000) }] }),
      list_branches: () => ({ isError: true, content: [{ type: "text", text: "Not Found" }] }),
    });
    fixture = await createFixture({
      backends: [githubBackend({ mcpUrl: upstream.url, token: TOKEN })],
      resources: { github: [ALLOWED] },
      logStream: { write: (line) => logs.push(line) },
    });
    client = await connectClient(fixture.mcpUrl("investimentos-api", "github"), fixture.token(DEV));
  });
  afterAll(async () => {
    await client.close();
    await fixture.close();
    await upstream.close();
  });

  function lastAudit() {
    const row = fixture.auditRows().at(-1);
    return JSON.parse(row?.details ?? "{}") as Record<string, unknown>;
  }

  it("lists the read-only repository tools and hides search_repositories and user tools", async () => {
    const names = (await client.listTools()).tools.map((tool) => tool.name);

    expect(names).toContain("get_file_contents");
    expect(names).toContain("search_code");
    expect(names).not.toContain("search_repositories");
    expect(names).not.toContain("get_me");
    expect(names).not.toContain("create_issue");
  });

  it("reads a file of the allowed repository, injecting the token and the read-only header", async () => {
    upstream.calls.length = 0;

    const result = await client.callTool({ name: "get_file_contents", arguments: { owner: "acme", repo: "investimentos-api", path: "README.md" } });

    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toBe("successfully downloaded text file\nfile README.md of acme/investimentos-api");
    expect(upstream.calls).toEqual([
      { name: "get_file_contents", args: { owner: "acme", repo: "investimentos-api", path: "README.md" }, authorization: `Bearer ${TOKEN}`, readonly: "true" },
    ]);
    expect(lastAudit()).toMatchObject({ outcome: "ok", resource_type: "repo", resource_id: ALLOWED });
  });

  it("accepts the repository name in any letter case", async () => {
    const result = await client.callTool({ name: "get_file_contents", arguments: { owner: "ACME", repo: "Investimentos-API", path: "a" } });

    expect(result.isError).not.toBe(true);
  });

  it("denies a repository that is not allowed without calling GitHub", async () => {
    upstream.calls.length = 0;

    const result = await client.callTool({ name: "get_file_contents", arguments: { owner: "acme", repo: "other", path: "README.md" } });

    expect(result.isError).toBe(true);
    expect(upstream.calls).toHaveLength(0);
    expect(lastAudit()).toMatchObject({ outcome: "denied", reason: "resource_not_allowed", resource_id: "acme/other" });
  });

  it("forwards only the declared arguments", async () => {
    upstream.calls.length = 0;

    await client.callTool({
      name: "get_file_contents",
      arguments: { owner: "acme", repo: "investimentos-api", path: "a", injected: "x", token: "y" },
    });

    expect(Object.keys(upstream.calls[0]?.args ?? {}).sort()).toEqual(["owner", "path", "repo"]);
  });

  it("searches only with the repo qualifier of an allowed repository", async () => {
    upstream.calls.length = 0;

    const allowed = await client.callTool({ name: "search_code", arguments: { query: `repo:${ALLOWED} handler` } });

    expect(allowed.isError).not.toBe(true);
    expect(upstream.calls.map((call) => call.args.query)).toEqual([`repo:${ALLOWED} handler`]);
  });

  const deniedQueries = [
    ["has no repo qualifier", "handler", "resource_not_identified"],
    ["names a repository that is not allowed", "repo:acme/other handler", "resource_not_allowed"],
    ["names two repositories", `repo:${ALLOWED} repo:acme/other`, "resource_not_identified"],
    ["widens the scope with OR", `repo:${ALLOWED} OR repo:acme/other`, "resource_not_identified"],
    ["adds an org qualifier", `repo:${ALLOWED} org:acme`, "resource_not_identified"],
  ] as const;
  for (const [title, query, reason] of deniedQueries) {
    it(`denies a code search that ${title}`, async () => {
      upstream.calls.length = 0;

      const result = await client.callTool({ name: "search_code", arguments: { query } });

      expect(result.isError).toBe(true);
      expect(upstream.calls).toHaveLength(0);
      expect(lastAudit()).toMatchObject({ outcome: "denied", reason });
    });
  }

  it("denies search_repositories because the tool is not exposed", async () => {
    upstream.calls.length = 0;

    const result = await client.callTool({ name: "search_repositories", arguments: { query: "repo:acme/investimentos-api" } });

    expect(result.isError).toBe(true);
    expect(upstream.calls).toHaveLength(0);
    expect(lastAudit()).toMatchObject({ outcome: "denied", reason: "tool_not_declared" });
  });

  it("wraps a response above the limit in valid JSON with id and source", async () => {
    const result = await client.callTool({ name: "list_commits", arguments: { owner: "acme", repo: "investimentos-api" } });

    const text = textOf(result);
    expect(text.length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
    expect(JSON.parse(text)).toMatchObject({ id: `list_commits:${ALLOWED}`, source: "github", truncated: true, total_chars: 20_000 });
  });

  it("passes an upstream error result through as an error", async () => {
    const result = await client.callTool({ name: "list_branches", arguments: { owner: "acme", repo: "investimentos-api" } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Not Found");
    expect(lastAudit()).toMatchObject({ outcome: "error", reason: "tool_error" });
  });

  it("never exposes the token to the developer, the audit trail or the logs", async () => {
    const result = await client.callTool({ name: "get_file_contents", arguments: { owner: "acme", repo: "investimentos-api", path: "a" } });

    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(JSON.stringify(fixture.auditRows())).not.toContain(TOKEN);
    expect(logs.join("")).not.toContain(TOKEN);
  });
});

describe("github backend when GitHub is unreachable", () => {
  it("reports a generic error without the token or the address", async () => {
    const fixture = await createFixture({
      backends: [githubBackend({ mcpUrl: "http://127.0.0.1:9/mcp/", token: TOKEN })],
      resources: { github: [ALLOWED] },
    });
    const client = await connectClient(fixture.mcpUrl("investimentos-api", "github"), fixture.token(DEV));

    const result = await client.callTool({ name: "get_file_contents", arguments: { owner: "acme", repo: "investimentos-api", path: "a" } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("GitHub MCP is unreachable or refused the call.");
    expect(JSON.parse(fixture.auditRows().at(-1)?.details ?? "{}")).toMatchObject({ outcome: "error" });
    await client.close();
    await fixture.close();
  });
});
