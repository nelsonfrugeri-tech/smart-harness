import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// What the gateway knows about one call, built after the token and the project were checked.
export interface ToolContext {
  userId: string;
  project: { id: string; slug: string; tenantId: string };
  server: string;
  correlationId: string;
  // Resources the project may use on this server, by resource type (for example repo: [...]).
  allowedResources: Readonly<Record<string, readonly string[]>>;
}

// Every tool says which resource it touches. The gateway enforces it; the backend never decides.
export type ToolAccess =
  // The tool acts on one resource named in its arguments. extract returns its id, or null when the
  // arguments do not identify one (the call is then denied).
  | { kind: "resource"; resourceType: string; extract(args: Record<string, unknown>): string | null }
  // The tool searches. It receives the allowed resources in ctx.allowedResources and must search
  // only in them. Empty lists skip the backend: empty success by default, denial when declared.
  | { kind: "search"; resourceType: string; denyWhenEmpty?: boolean };

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties?: Record<string, unknown>; required?: string[] };
  // A tool without access is hidden from tools/list and denied in tools/call.
  access?: ToolAccess;
}

export interface McpBackend {
  // Name used in the URL: /mcp/projects/{project}/{server}.
  server: string;
  listTools(ctx: ToolContext): ToolDefinition[] | Promise<ToolDefinition[]>;
  callTool(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<CallToolResult>;
}

export type BackendRegistry = ReadonlyMap<string, McpBackend>;

export function createRegistry(backends: readonly McpBackend[]): BackendRegistry {
  const registry = new Map<string, McpBackend>();
  for (const backend of backends) {
    if (registry.has(backend.server)) {
      throw new Error(`MCP backend "${backend.server}" is registered twice`);
    }
    registry.set(backend.server, backend);
  }
  return registry;
}
