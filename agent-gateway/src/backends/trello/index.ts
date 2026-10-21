import type { McpBackend, ToolDefinition } from "../../mcp/backend.ts";
import { argument, client, failure, fits, limit, record, result, text } from "./shared.ts";

const TOOLS: ToolDefinition[] = ["list_cards", "get_card"].map((name) => ({
  name,
  description: name === "list_cards" ? "Lists open cards in an allowed board, newest first, with an upstream card ID cursor." : "Reads a card belonging to an allowed board.",
  inputSchema: {
    type: "object", properties: { board: { type: "string" }, card: { type: "string" }, cursor: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50 } },
    required: name === "get_card" ? ["board", "card"] : ["board"],
  },
  access: { kind: "resource", resourceType: "board", extract: (args) => typeof args.board === "string" ? args.board : null },
}));

function identifier(value: string): string {
  if (!/^[a-zA-Z0-9]{1,100}$/.test(value)) throw new Error("Invalid identifier.");
  return value;
}

function card(value: unknown, board: string) {
  const item = record(value);
  if (item.idBoard !== board) throw new Error("Access denied.");
  const id = identifier(argument(item, "id"));
  return { id, board, name: text(item.name), description: text(item.desc, 800), source: `https://trello.com/c/${id}`, truncated: (typeof item.name === "string" && text(item.name) !== item.name) || (typeof item.desc === "string" && text(item.desc, 800) !== item.desc) };
}

export function createTrelloBackend(config: { apiKey: string; token: string; baseUrl?: string }): McpBackend {
  const get = client(config.baseUrl ?? "https://api.trello.com/1/", {
    Authorization: `OAuth oauth_consumer_key="${encodeURIComponent(config.apiKey)}", oauth_token="${encodeURIComponent(config.token)}"`,
    Accept: "application/json",
  });
  return {
    server: "trello", listTools: () => TOOLS,
    async callTool(ctx, name, args) {
      try {
        const board = identifier(argument(args, "board"));
        if (!(ctx.allowedResources.board ?? []).includes(board)) return failure();
        if (name === "get_card") return result({ card: card(await get(`cards/${identifier(argument(args, "card"))}?fields=id,idBoard,name,desc`), board) });
        if (name !== "list_cards") return failure();
        const count = limit(args);
        const cursor = args.cursor === undefined ? "" : identifier(argument(args, "cursor"));
        // Nested Cards documents limit, sort=-id and before. Fetch one lookahead item,
        // then resume after the last item actually returned if the byte budget clips the page.
        const query = new URLSearchParams({ fields: "id,idBoard,name,desc", filter: "open", sort: "-id", limit: String(count + 1) });
        if (cursor !== "") query.set("before", cursor);
        const upstream = await get(`boards/${board}/cards?${query}`);
        if (!Array.isArray(upstream) || upstream.length > count + 1) return failure();
        const remaining = upstream.map((item) => card(item, board));
        for (let index = 0; index < remaining.length; index++) {
          const previous = index === 0 ? cursor : remaining[index - 1].id;
          if (previous !== "" && remaining[index].id >= previous) return failure();
        }
        const items: ReturnType<typeof card>[] = [];
        for (const item of remaining) {
          if (items.length >= count || !fits({ items: [...items, item] })) break;
          items.push(item);
        }
        return result({ items, next_cursor: items.length < remaining.length ? items.at(-1)?.id ?? null : null });
      } catch { return failure(); }
    },
  };
}
