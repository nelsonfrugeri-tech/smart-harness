import type { McpBackend, ToolDefinition } from "../mcp/backend.ts";

// Test backend, registered only with APP_ENV=local. It calls no external service.
// The resource type "item" is permitted per project in gateway_permissions (server "echo").

const TOOLS: ToolDefinition[] = [
  {
    name: "echo_message",
    description: "Returns the message. Acts on one item, which must be allowed for the project.",
    inputSchema: {
      type: "object",
      properties: { item: { type: "string" }, message: { type: "string" } },
      required: ["item", "message"],
    },
    access: {
      kind: "resource",
      resourceType: "item",
      extract: (args) => (typeof args.item === "string" ? args.item : null),
    },
  },
  {
    name: "echo_search",
    description: "Lists the allowed items that contain the query. Searches only the project's allowed items.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    access: { kind: "search", resourceType: "item" },
  },
];

export const echoBackend: McpBackend = {
  server: "echo",
  listTools: () => TOOLS,
  async callTool(ctx, name, args) {
    if (name === "echo_message") {
      return { content: [{ type: "text", text: `echo: ${String(args.message)}` }] };
    }
    if (name === "echo_search") {
      const query = String(args.query);
      const items = (ctx.allowedResources.item ?? []).filter((item) => item.includes(query));
      return { content: [{ type: "text", text: JSON.stringify({ items }) }] };
    }
    throw new Error(`unknown tool ${name}`);
  },
};
