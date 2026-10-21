import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { normalizePageId, notionBackend } from "../../src/backends/notion.ts";
import { MAX_RESPONSE_CHARS } from "../../src/mcp/limits.ts";
import { connectClient, createFixture, DEV, type Fixture } from "../test-support.ts";
import { startFakeRest, type FakeServer } from "./fakes.ts";

const TOKEN = "ntn_FAKE_INTEGRATION_TOKEN_0123456789";
const VERSION = "2026-03-11";
const PAGE_A = "1111111111114111a111111111111111";
const PAGE_C = "3333333333334333a333333333333333";
const PAGE_B = "2222222222224222a222222222222222"; // exists in the workspace, not allowed for the project

function dashed(id: string): string {
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

function page(id: string, title: string) {
  return {
    object: "page",
    id: dashed(id),
    url: `https://www.notion.so/${id}`,
    last_edited_time: "2026-10-20T10:00:00.000Z",
    properties: { Name: { type: "title", title: [{ plain_text: title }] }, Owner: { type: "people", people: [] } },
  };
}

function paragraph(text: string) {
  return { type: "paragraph", paragraph: { rich_text: [{ plain_text: text }] } };
}

function textOf(result: unknown): string {
  return (result as { content: { text?: string }[] }).content.map((part) => part.text ?? "").join("");
}

describe("normalizePageId", () => {
  it("accepts the dashed and the plain form and rejects anything else", () => {
    expect(normalizePageId(dashed(PAGE_A).toUpperCase())).toBe(PAGE_A);
    expect(normalizePageId(PAGE_A)).toBe(PAGE_A);
    expect(normalizePageId("page-investimentos-adrs")).toBeNull();
    expect(normalizePageId(`${PAGE_A}/children`)).toBeNull();
    expect(normalizePageId(7)).toBeNull();
  });
});

describe("notion backend through the gateway", () => {
  let upstream: FakeServer;
  let fixture: Fixture;
  let client: Client;
  let bigContent = false;
  const logs: string[] = [];

  beforeAll(async () => {
    upstream = await startFakeRest((path) => {
      const [route = "", query = ""] = path.split("?");
      if (route === `/pages/${dashed(PAGE_A)}` || route === `/pages/${PAGE_A}`) return { body: page(PAGE_A, "ADR 0001 Single table") };
      if (route === `/pages/${PAGE_C}`) return { body: page(PAGE_C, "Runbook") };
      if (route === `/pages/${PAGE_B}`) return { body: page(PAGE_B, "ADR secret of another team") };
      if (route === `/blocks/${PAGE_A}/children`) {
        if (bigContent) return { body: { results: [paragraph("p".repeat(30_000))], has_more: false, next_cursor: null } };
        return query.includes("start_cursor=cur2")
          ? { body: { results: [paragraph("second block")], has_more: false, next_cursor: null } }
          : {
              body: {
                results: [{ type: "heading_1", heading_1: { rich_text: [{ plain_text: "Context" }] } }, paragraph("first block")],
                has_more: true,
                next_cursor: "cur2",
              },
            };
      }
      return { status: 404, body: {} };
    });
    fixture = await createFixture({
      backends: [notionBackend({ apiUrl: upstream.url, token: TOKEN, version: VERSION })],
      resources: { notion: [PAGE_A, PAGE_C] },
      logStream: { write: (line) => logs.push(line) },
    });
    client = await connectClient(fixture.mcpUrl("investimentos-api", "notion"), fixture.token(DEV));
  });
  afterAll(async () => {
    await client.close();
    await fixture.close();
    await upstream.close();
  });

  function lastAudit() {
    return JSON.parse(fixture.auditRows().at(-1)?.details ?? "{}") as Record<string, unknown>;
  }

  it("reads an allowed page with the title and the text of all its blocks, sending token and version", async () => {
    upstream.requests.length = 0;

    const result = await client.callTool({ name: "notion_get_page", arguments: { page_id: dashed(PAGE_A) } });

    expect(JSON.parse(textOf(result))).toMatchObject({
      title: "ADR 0001 Single table",
      content: "# Context\nfirst block\nsecond block",
      content_complete: true,
      source: `notion:page/${dashed(PAGE_A)}`,
    });
    for (const request of upstream.requests) {
      expect(request.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(request.headers["notion-version"]).toBe(VERSION);
    }
    expect(lastAudit()).toMatchObject({ outcome: "ok", resource_type: "page", resource_id: PAGE_A });
  });

  it("denies a page that is not allowed without calling Notion", async () => {
    upstream.requests.length = 0;

    const result = await client.callTool({ name: "notion_get_page", arguments: { page_id: PAGE_B } });

    expect(result.isError).toBe(true);
    expect(upstream.requests).toHaveLength(0);
    expect(lastAudit()).toMatchObject({ outcome: "denied", reason: "resource_not_allowed", resource_id: PAGE_B });
  });

  it("denies a value that is not a page id", async () => {
    const result = await client.callTool({ name: "notion_get_page", arguments: { page_id: `${PAGE_A}/children` } });

    expect(result.isError).toBe(true);
    expect(lastAudit()).toMatchObject({ outcome: "denied", reason: "resource_not_identified" });
  });

  it("searches by title and never returns a page outside the allowed set", async () => {
    const adr = JSON.parse(textOf(await client.callTool({ name: "notion_search_pages", arguments: { query: "adr" } })));
    const all = JSON.parse(textOf(await client.callTool({ name: "notion_search_pages", arguments: {} })));

    // PAGE_B also has "ADR" in its title, but it is not allowed.
    expect(adr.items.map((item: { title: string }) => item.title)).toEqual(["ADR 0001 Single table"]);
    expect(all.items.map((item: { title: string }) => item.title).sort()).toEqual(["ADR 0001 Single table", "Runbook"]);
    expect(JSON.stringify([adr, all])).not.toContain(PAGE_B);
    expect(upstream.requests.some((request) => request.url.includes(PAGE_B))).toBe(false);
    expect(lastAudit()).toMatchObject({ outcome: "ok", resource_type: "page", resource_count: 2 });
  });

  it("denies the search and skips Notion when the project has no allowed page", async () => {
    const other = await connectClient(fixture.mcpUrl("investimentos-web", "notion"), fixture.token(DEV));
    upstream.requests.length = 0;

    const result = await other.callTool({ name: "notion_search_pages", arguments: { query: "adr" } });

    expect(result.isError).toBe(true);
    expect(upstream.requests).toHaveLength(0);
    expect(lastAudit()).toMatchObject({ outcome: "denied", reason: "no_allowed_resources" });
    await other.close();
  });

  it("reduces a page above the limit to valid JSON that keeps id and source", async () => {
    bigContent = true;
    try {
      const result = await client.callTool({ name: "notion_get_page", arguments: { page_id: PAGE_A } });

      const text = textOf(result);
      expect(text.length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
      expect(JSON.parse(text)).toMatchObject({ id: dashed(PAGE_A), source: `notion:page/${dashed(PAGE_A)}`, truncated: true });
    } finally {
      bigContent = false;
    }
  });

  it("never exposes the token to the developer, the audit trail or the logs", async () => {
    const result = await client.callTool({ name: "notion_get_page", arguments: { page_id: PAGE_A } });

    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(JSON.stringify(fixture.auditRows())).not.toContain(TOKEN);
    expect(logs.join("")).not.toContain(TOKEN);
  });
});
