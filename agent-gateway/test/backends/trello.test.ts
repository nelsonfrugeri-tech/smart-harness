import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { trelloBackend } from "../../src/backends/trello.ts";
import { MAX_RESPONSE_CHARS } from "../../src/mcp/limits.ts";
import { connectClient, createFixture, DEV, type Fixture } from "../test-support.ts";
import { startFakeRest, type FakeServer } from "./fakes.ts";

const API_KEY = "trello-key-FAKE-0123456789";
const TOKEN = "trello-token-FAKE-abcdefghij";
const BOARD = "6ad914e240df9fe7aff0c9b2";
const SECOND_BOARD = "6ad914e240df9fe7aff0c9b3";

const cards = Array.from({ length: 90 }, (_, i) => ({
  id: `card${String(i).padStart(3, "0")}`,
  name: `Card ${i} ${"n".repeat(200)}`,
  idList: i % 2 === 0 ? "list-todo" : "list-doing",
  shortUrl: `https://trello.com/c/card${i}`,
  due: null,
  dateLastActivity: "2026-10-20T10:00:00.000Z",
  labels: [{ name: "backend" }],
}));

function cardDetail(boardShortLink: string, desc = "Acceptance criteria") {
  return {
    id: "card001",
    name: "Paginate positions",
    desc,
    idBoard: `full-${boardShortLink}`,
    idList: "list-todo",
    shortUrl: "https://trello.com/c/card001",
    due: null,
    dueComplete: false,
    labels: [{ name: "backend" }],
    checklists: [{ name: "Steps", checkItems: [{ name: "write test", state: "complete" }] }],
    board: { id: `full-${boardShortLink}`, shortLink: boardShortLink },
    list: { name: "To do" },
  };
}

function textOf(result: unknown): string {
  return (result as { content: { text?: string }[] }).content.map((part) => part.text ?? "").join("");
}

describe("trello backend through the gateway", () => {
  let upstream: FakeServer;
  let fixture: Fixture;
  let client: Client;
  let cardDesc = "Acceptance criteria";
  let cardBoard = BOARD;
  let failWith: number | undefined;
  let boardResponseId = BOARD;
  let failSecondBoard = false;
  const logs: string[] = [];

  beforeAll(async () => {
    upstream = await startFakeRest((path) => {
      if (failWith !== undefined) return { status: failWith, body: { message: "invalid key" } };
      if (path === `/boards/${BOARD}?fields=name,shortUrl,shortLink`) {
        return { body: { id: boardResponseId, shortLink: "Ab12Cd34", name: "Demo", shortUrl: "https://trello.com/b/Ab12Cd34" } };
      }
      if (path === `/boards/${SECOND_BOARD}?fields=name,shortUrl,shortLink`) {
        return failSecondBoard
          ? { status: 503, body: {} }
          : { body: { id: SECOND_BOARD, name: "Second demo", shortUrl: "https://trello.com/b/Zz99Yy88" } };
      }
      if (path.startsWith(`/boards/${BOARD}/cards`)) return { body: cards };
      if (path.startsWith(`/boards/${BOARD}/lists`)) return { body: [{ id: "list-todo", name: "To do" }, { id: "list-doing", name: "Doing" }] };
      if (path.startsWith("/cards/card001") || path.startsWith("/cards/gk1RNu5b")) return { body: cardDetail(cardBoard, cardDesc) };
      const discovered = /^\/boards\/(board[0-9]+)\?fields=name,shortUrl,shortLink$/.exec(path);
      if (discovered !== null) return { body: { id: discovered[1], name: "Board", shortUrl: "https://trello.com/b/example" } };
      return { status: 404, body: {} };
    });
    fixture = await createFixture({
      backends: [trelloBackend({ apiUrl: upstream.url, apiKey: API_KEY, token: TOKEN })],
      resources: { trello: [BOARD, SECOND_BOARD] },
      logStream: { write: (line) => logs.push(line) },
    });
    client = await connectClient(fixture.mcpUrl("investimentos-api", "trello"), fixture.token(DEV));
  });
  afterAll(async () => {
    await client.close();
    await fixture.close();
    await upstream.close();
  });

  function lastAudit() {
    return JSON.parse(fixture.auditRows().at(-1)?.details ?? "{}") as Record<string, unknown>;
  }

  it("discovers only allowed boards and uses the returned full board id with a card short link", async () => {
    upstream.requests.length = 0;
    const result = await client.callTool({ name: "trello_list_boards", arguments: {} });
    expect(result.isError).not.toBe(true);
    const page = JSON.parse(textOf(result));
    expect(page.items).toEqual([
      { id: BOARD, source: `trello:board/${BOARD}`, name: "Demo", url: "https://trello.com/b/Ab12Cd34" },
      { id: SECOND_BOARD, source: `trello:board/${SECOND_BOARD}`, name: "Second demo", url: "https://trello.com/b/Zz99Yy88" },
    ]);
    expect(upstream.requests.map((request) => request.url)).toEqual([
      `/boards/${BOARD}?fields=name,shortUrl,shortLink`,
      `/boards/${SECOND_BOARD}?fields=name,shortUrl,shortLink`,
    ]);
    const card = await client.callTool({ name: "trello_get_card", arguments: { board_id: page.items[0].id, card_id: "gk1RNu5b" } });
    expect(card.isError).not.toBe(true);
    expect(JSON.parse(textOf(card)).description).toBe("Acceptance criteria");
  });

  it("paginates discovery and bounds the board reads before contacting Trello", async () => {
    const extra = Array.from({ length: 51 }, (_, index) => `board${index}`);
    const project = fixture.apiDb.prepare("SELECT id FROM projects WHERE slug = 'investimentos-api'").get() as { id: string };
    const grant = fixture.apiDb.prepare("INSERT INTO gateway_permissions (project_id, server, resource_type, resource_id) VALUES (?, 'trello', 'board', ?)");
    for (const id of extra) grant.run(project.id, id);
    try {
      const ids: string[] = [];
      let cursor: string | undefined;
      do {
        upstream.requests.length = 0;
        const result = await client.callTool({ name: "trello_list_boards", arguments: cursor === undefined ? {} : { cursor } });
        expect(result.isError).not.toBe(true);
        expect(upstream.requests.length).toBeLessThanOrEqual(50);
        expect(textOf(result).length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
        const page = JSON.parse(textOf(result)) as { items: { id: string }[]; next_cursor?: string };
        ids.push(...page.items.map((item) => item.id));
        cursor = page.next_cursor;
      } while (cursor !== undefined && ids.length < 100);
      expect(ids.sort()).toEqual([BOARD, SECOND_BOARD, ...extra].sort());
    } finally {
      const revoke = fixture.apiDb.prepare("DELETE FROM gateway_permissions WHERE project_id = ? AND server = 'trello' AND resource_id = ?");
      for (const id of extra) revoke.run(project.id, id);
    }
  });

  it("denies discovery without an allowed board and never contacts Trello", async () => {
    const other = await connectClient(fixture.mcpUrl("investimentos-web", "trello"), fixture.token(DEV));
    try {
      upstream.requests.length = 0;
      const result = await other.callTool({ name: "trello_list_boards", arguments: {} });
      expect(result.isError).toBe(true);
      expect(upstream.requests).toHaveLength(0);
      expect(lastAudit()).toMatchObject({ outcome: "denied", reason: "no_allowed_resources" });
    } finally {
      await other.close();
    }
  });

  it("fails closed when a board response belongs outside the allowlist", async () => {
    boardResponseId = "6ad914e240df9fe7aff0c9b4";
    try {
      const result = await client.callTool({ name: "trello_list_boards", arguments: {} });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe("Trello returned a board outside the allowed set.");
      expect(textOf(result)).not.toContain("Demo");
      expect(textOf(result)).not.toContain(boardResponseId);
    } finally {
      boardResponseId = BOARD;
    }
  });

  it("reports partial upstream failure instead of presenting incomplete discovery as success", async () => {
    failSecondBoard = true;
    try {
      const result = await client.callTool({ name: "trello_list_boards", arguments: {} });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe("Trello answered HTTP 503.");
      expect(textOf(result)).not.toContain("Demo");
    } finally {
      failSecondBoard = false;
    }
  });

  it("lists the cards of the allowed board with their list names, sending the credentials in the header", async () => {
    upstream.requests.length = 0;

    const result = await client.callTool({ name: "trello_list_cards", arguments: { board_id: BOARD } });

    const page = JSON.parse(textOf(result));
    expect(page.items[0]).toMatchObject({ id: "card000", list: "To do", labels: ["backend"], source: `trello:board/${BOARD}` });
    expect(upstream.requests.length).toBeGreaterThan(0);
    for (const request of upstream.requests) {
      expect(request.headers.authorization).toBe(`OAuth oauth_consumer_key="${API_KEY}", oauth_token="${TOKEN}"`);
      expect(request.url).not.toContain(TOKEN);
    }
    expect(lastAudit()).toMatchObject({ outcome: "ok", resource_type: "board", resource_id: BOARD });
  });

  it("walks all cards page by page, each card once", async () => {
    const ids: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const result = await client.callTool({ name: "trello_list_cards", arguments: { board_id: BOARD, ...(cursor === undefined ? {} : { cursor }) } });
      expect(textOf(result).length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
      const page = JSON.parse(textOf(result)) as { items: { id: string }[]; next_cursor?: string };
      ids.push(...page.items.map((item) => item.id));
      cursor = page.next_cursor;
      pages++;
    } while (cursor !== undefined && pages < 50);

    expect(pages).toBeGreaterThan(1);
    expect(ids).toEqual(cards.map((card) => card.id));
  });

  it("denies a board that is not allowed without calling Trello", async () => {
    upstream.requests.length = 0;

    const result = await client.callTool({ name: "trello_list_cards", arguments: { board_id: "Zz99Yy88" } });

    expect(result.isError).toBe(true);
    expect(upstream.requests).toHaveLength(0);
    expect(lastAudit()).toMatchObject({ outcome: "denied", reason: "resource_not_allowed", resource_id: "Zz99Yy88" });
  });

  it("denies a board id that is not a plain identifier", async () => {
    upstream.requests.length = 0;

    const result = await client.callTool({ name: "trello_list_cards", arguments: { board_id: `${BOARD}/../members/me` } });

    expect(result.isError).toBe(true);
    expect(upstream.requests).toHaveLength(0);
    expect(lastAudit()).toMatchObject({ outcome: "denied", reason: "resource_not_identified" });
  });

  it("reads a card of the allowed board", async () => {
    const result = await client.callTool({ name: "trello_get_card", arguments: { board_id: BOARD, card_id: "card001" } });

    expect(JSON.parse(textOf(result))).toMatchObject({
      id: "card001",
      description: "Acceptance criteria",
      list: "To do",
      checklists: [{ name: "Steps", items: ["complete: write test"] }],
    });
  });

  it("refuses a card that belongs to another board and returns none of its data", async () => {
    cardBoard = "Other999";
    try {
      const result = await client.callTool({ name: "trello_get_card", arguments: { board_id: BOARD, card_id: "card001" } });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe("The card does not belong to this board.");
      expect(lastAudit()).toMatchObject({ outcome: "error", resource_id: BOARD });
    } finally {
      cardBoard = BOARD;
    }
  });

  it("reduces a card above the limit to valid JSON that keeps id and source", async () => {
    cardDesc = "d".repeat(30_000);
    try {
      const result = await client.callTool({ name: "trello_get_card", arguments: { board_id: BOARD, card_id: "card001" } });

      const text = textOf(result);
      expect(text.length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
      expect(JSON.parse(text)).toMatchObject({ id: "card001", source: `trello:board/${BOARD}`, name: "Paginate positions", truncated: true });
    } finally {
      cardDesc = "Acceptance criteria";
    }
  });

  it("reports a Trello error by status only and never shows the credentials", async () => {
    failWith = 401;
    try {
      const result = await client.callTool({ name: "trello_list_cards", arguments: { board_id: BOARD } });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe("Trello answered HTTP 401.");
    } finally {
      failWith = undefined;
    }
    expect(JSON.stringify(fixture.auditRows())).not.toContain(TOKEN);
    expect(JSON.stringify(fixture.auditRows())).not.toContain(API_KEY);
    expect(logs.join("")).not.toContain(TOKEN);
    expect(logs.join("")).not.toContain(API_KEY);
  });
});
