import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { McpBackend, ToolContext } from "./backend.ts";
import { discoverTools, executeToolCall, type ToolCallOutcome } from "./tool-call.ts";

export type ToolCallRecorder = (tool: string, call: ToolCallOutcome) => void;

// One MCP server per HTTP request (no session). tools/list shows only tools that declare a
// resource; every tools/call goes through executeToolCall and is reported to `record`.
export function createMcpServer(backend: McpBackend, ctx: ToolContext, record: ToolCallRecorder): Server {
  const server = new Server(
    { name: `smart-harness-gateway-${backend.server}`, version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await discoverTools(backend, ctx);
    if (tools === null) {
      throw new Error("The tool catalog is unavailable.");
    }
    return {
      tools: tools
        .filter((tool) => tool.access !== undefined)
        .map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const call = await executeToolCall(backend, ctx, name, args ?? {});
    record(name, call);
    return call.result;
  });

  return server;
}
