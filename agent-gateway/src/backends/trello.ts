import type { McpBackend, ToolDefinition } from "../mcp/backend.ts";
import { MAX_RESPONSE_CHARS, pageOfList, reduceObject, type Item } from "../mcp/limits.ts";
import { jsonResult, ToolError, withToolErrors } from "../mcp/result.ts";
import { asArray, asRecord, asString, fetchJson } from "./rest.ts";

// Trello through its REST API with the gateway's API key and token.
// The official Trello MCP (Atlassian, mcp.trello.com) only supports interactive OAuth, so it cannot
// take credentials injected by the gateway. These two read-only tools cover the use case instead.
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

const TOOLS: ToolDefinition[] = [
  {
    name: "trello_list_cards",
    description: "Lists the open cards of an allowed board (id, name, list, labels, due date). Pass next_cursor as cursor for the next page.",
    inputSchema: {
      type: "object",
      properties: { board_id: { type: "string" }, cursor: { type: "string" } },
      required: ["board_id"],
    },
    access: { kind: "resource", resourceType: "board", extract: (args) => trelloId(args.board_id) },
  },
  {
    name: "trello_get_card",
    description: "Reads one card (description, labels, checklists) of an allowed board.",
    inputSchema: {
      type: "object",
      properties: { board_id: { type: "string" }, card_id: { type: "string" } },
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
    callTool: (_ctx, name, args) =>
      withToolErrors(async () => {
        const boardId = trelloId(args.board_id);
        if (boardId === null) throw new ToolError("board_id is required.");
        if (name === "trello_list_cards") return jsonResult(await listCards(get, boardId, args.cursor));
        if (name === "trello_get_card") return jsonResult(await getCard(get, boardId, args.card_id));
        throw new ToolError(`Unknown tool ${name}.`);
      }),
  };
}

type Get = (path: string) => Promise<unknown>;

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
