import type { McpBackend, ToolDefinition } from "../mcp/backend.ts";
import { MAX_RESPONSE_CHARS, pageOfList, reduceObject, type Item } from "../mcp/limits.ts";
import { jsonResult, ToolError, withToolErrors } from "../mcp/result.ts";
import { asArray, asRecord, asString, fetchJson } from "./rest.ts";

// Trello through its REST API with the gateway's API key and token.
// The official Trello MCP (Atlassian, mcp.trello.com) only supports interactive OAuth, so it cannot
// take credentials injected by the gateway. These read-only tools cover the use case instead.
// The resource type "board" is permitted per project in gateway_permissions (server "trello").

export interface TrelloOptions {
  apiUrl: string;
  apiKey: string;
  token: string;
}

const TRELLO_ID = /^[A-Za-z0-9]{1,64}$/;

function trelloId(value: unknown): string | null {
  return typeof value === "string" && TRELLO_ID.test(value) ? value : null;
}

const BOARD_ID_SCHEMA = {
  type: "string",
  description: "Use the id returned by trello_list_boards, not a card id, board name or URL.",
};

const TOOLS: ToolDefinition[] = [
  {
    name: "trello_list_boards",
    description: "Discovers only the boards allowed in this context. Call this first, then pass an item's id as board_id to list or read cards. Pass next_cursor as cursor for the next page.",
    inputSchema: { type: "object", properties: { cursor: { type: "string" } } },
    access: { kind: "search", resourceType: "board" },
  },
  {
    name: "trello_list_cards",
    description: "Lists the cards of an allowed board (id, name, list, labels, due date). Discover board_id with trello_list_boards first. Pass next_cursor as cursor for the next page.",
    inputSchema: {
      type: "object",
      properties: { board_id: BOARD_ID_SCHEMA, cursor: { type: "string" } },
      required: ["board_id"],
    },
    access: { kind: "resource", resourceType: "board", extract: (args) => trelloId(args.board_id) },
  },
  {
    name: "trello_get_card",
    description: "Reads one card (description, labels, checklists) of an allowed board. Discover board_id with trello_list_boards first; card_id accepts the full card id or the short link from a /c/ URL.",
    inputSchema: {
      type: "object",
      properties: { board_id: BOARD_ID_SCHEMA, card_id: { type: "string" } },
      required: ["board_id", "card_id"],
    },
    access: { kind: "resource", resourceType: "board", extract: (args) => trelloId(args.board_id) },
  },
];

export function trelloBackend(options: TrelloOptions): McpBackend {
  // The credentials go in the Authorization header, so they never appear in a URL.
  const headers = { Authorization: `OAuth oauth_consumer_key="${options.apiKey}", oauth_token="${options.token}"` };
  const get = (path: string) => fetchJson("Trello", `${options.apiUrl}${path}`, { headers });

  return {
    server: "trello",
    listTools: () => TOOLS,
    callTool: (ctx, name, args) =>
      withToolErrors(async () => {
        if (name === "trello_list_boards") return jsonResult(await listBoards(get, ctx.allowedResources.board ?? [], args.cursor));
        const boardId = trelloId(args.board_id);
        if (boardId === null) throw new ToolError("board_id is required.");
        if (name === "trello_list_cards") return jsonResult(await listCards(get, boardId, args.cursor));
        if (name === "trello_get_card") return jsonResult(await getCard(get, boardId, args.card_id));
        throw new ToolError(`Unknown tool ${name}.`);
      }),
  };
}

type Get = (path: string) => Promise<unknown>;

// Read only the permitted ids, never the credential owner's complete board list.
// Page before fetching so each call makes at most MAX_ITEMS_PER_PAGE upstream requests.
async function listBoards(get: Get, allowed: readonly string[], cursor: unknown) {
  const candidates = allowed.map((id) => {
    if (trelloId(id) === null) throw new ToolError("An allowed board id is invalid.");
    return { id, source: `trello:board/${id}` };
  });
  const selected = pageOfList(candidates, typeof cursor === "string" ? cursor : undefined);
  const items: Item[] = await Promise.all(selected.items.map(async (item) => {
    const board = asRecord(await get(`/boards/${item.id}?fields=name,shortUrl,shortLink`));
    const id = trelloId(board.id);
    if (id === null || (id !== item.id && trelloId(board.shortLink) !== item.id)) {
      throw new ToolError("Trello returned a board outside the allowed set.");
    }
    // Preserve the exact permitted identifier, including configured short links.
    return { ...item, name: asString(board.name), url: asString(board.shortUrl) };
  }));
  const result = pageOfList(items, undefined);
  if (result.next_cursor === undefined && selected.next_cursor !== undefined) result.next_cursor = selected.next_cursor;
  return result;
}

async function listCards(get: Get, boardId: string, cursor: unknown) {
  const [cards, lists] = await Promise.all([
    get(`/boards/${boardId}/cards?fields=name,idList,shortUrl,due,dateLastActivity,labels`),
    get(`/boards/${boardId}/lists?fields=name`),
  ]);
  const listNames = new Map(asArray(lists).map((list) => [asString(asRecord(list).id), asString(asRecord(list).name)]));
  const items: Item[] = asArray(cards).map((card) => {
    const c = asRecord(card);
    return {
      id: asString(c.id),
      source: `trello:board/${boardId}`,
      name: asString(c.name),
      list: listNames.get(asString(c.idList)) ?? null,
      url: asString(c.shortUrl),
      due: c.due ?? null,
      labels: asArray(c.labels).map((label) => asString(asRecord(label).name)),
      last_activity: asString(c.dateLastActivity),
    };
  });
  return pageOfList(items, typeof cursor === "string" ? cursor : undefined);
}

async function getCard(get: Get, boardId: string, cardId: unknown) {
  const id = trelloId(cardId);
  if (id === null) throw new ToolError("card_id is required.");
  const card = asRecord(
    await get(
      `/cards/${id}?fields=name,desc,idBoard,idList,shortUrl,due,dueComplete,labels,dateLastActivity` +
        "&checklists=all&checklist_fields=name&board=true&board_fields=shortLink&list=true&list_fields=name",
    ),
  );
  // The authorizer checked the board in the arguments; the card must really belong to it.
  const board = asRecord(card.board);
  if (boardId !== asString(card.idBoard) && boardId !== asString(board.id) && boardId !== asString(board.shortLink)) {
    throw new ToolError("The card does not belong to this board.");
  }
  return reduceObject(
    {
      id: asString(card.id),
      source: `trello:board/${boardId}`,
      name: asString(card.name),
      description: asString(card.desc),
      list: asString(asRecord(card.list).name),
      url: asString(card.shortUrl),
      due: card.due ?? null,
      due_complete: card.dueComplete === true,
      labels: asArray(card.labels).map((label) => asString(asRecord(label).name)),
      checklists: asArray(card.checklists).map((checklist) => ({
        name: asString(asRecord(checklist).name),
        items: asArray(asRecord(checklist).checkItems).map((entry) => `${asString(asRecord(entry).state)}: ${asString(asRecord(entry).name)}`),
      })),
    },
    MAX_RESPONSE_CHARS,
  );
}
