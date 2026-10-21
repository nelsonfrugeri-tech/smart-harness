import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { McpBackend, ToolContext, ToolDefinition } from "../../mcp/backend.ts";
import { boundResult, readCursor } from "./response.ts";

const DEFAULT_URL = "https://api.githubcopilot.com/mcp/readonly";
const SEARCH = new Set(["search_code", "search_commits", "search_issues", "search_pull_requests"]);
const READ = new Set(["get_file_contents", "issue_read", "pull_request_read"]);
const METHODS = new Set(["get", "get_comments", "get_diff", "get_files", "get_reviews", "get_review_comments", "get_status"]);
const FIELDS = new Set(["owner", "repo", "path", "ref", "sha", "method", "issue_number", "pullNumber", "after", "page", "perPage", "query", "sort", "order"]);
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/;

export function createGithubBackend(options: { token: string; url?: string }): McpBackend {
  let url: URL;
  try {
    url = new URL(options.url ?? DEFAULT_URL);
    const local = url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if ((!local && url.href !== DEFAULT_URL) || url.username || url.password || !options.token || /\s/.test(options.token)) throw new Error();
  } catch { throw new Error("GitHub backend configuration is invalid."); }
  let catalog: Promise<ToolDefinition[]> | undefined;
  async function remote<T>(run: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ name: "smart-harness-github", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${options.token}`, "X-MCP-Readonly": "true" }, redirect: "error" },
      reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
    });
    try {
      await client.connect(transport, { timeout: 15000 });
      return await run(client);
    } catch { throw new Error("GitHub MCP service is unavailable."); }
    finally { await client.close().catch(() => undefined); }
  }
  const listTools = async (): Promise<ToolDefinition[]> => {
    catalog ??= remote(async (client) => {
      const tools: Tool[] = [];
      let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        const page = await client.listTools({ cursor }, { timeout: 15000 });
        tools.push(...page.tools);
        if (tools.length > 1000 || (page.nextCursor && seen.has(page.nextCursor))) throw new Error();
        if (page.nextCursor) seen.add(page.nextCursor);
        cursor = page.nextCursor;
      } while (cursor);
      if (JSON.stringify(tools).includes(JSON.stringify(options.token).slice(1, -1))) throw new Error();
      return tools.flatMap(expose);
    }).catch(() => { catalog = undefined; throw new Error("GitHub tool catalog is unavailable."); });
    return catalog;
  };
  return {
    server: "github", listTools,
    async callTool(ctx, name, args) {
      if (!authorized(ctx, name, args)) return error("access_denied");
      const tool = (await listTools()).find((candidate) => candidate.name === name);
      if (!tool || Object.keys(args).some((key) => key !== "harnessCursor" && !(key in (tool.inputSchema.properties ?? {})))) return error("invalid_arguments");
      const { harnessCursor, ...upstream } = args;
      const binding = createHash("sha256").update(JSON.stringify({ name, args: upstream })).digest("hex");
      const offset = readCursor(harnessCursor, binding);
      if (offset === null) return error("invalid_cursor");
      try {
        const result = await remote((client) => client.callTool({ name, arguments: upstream }, undefined, { timeout: 15000 }));
        if (result.isError || JSON.stringify(result).includes(JSON.stringify(options.token).slice(1, -1))) return error("upstream_error");
        return boundResult(result as CallToolResult, binding, offset);
      } catch { return error("upstream_error"); }
    },
  };
}
function expose(tool: Tool): ToolDefinition[] {
  const search = SEARCH.has(tool.name);
  if (!search && !READ.has(tool.name)) return [];
  const properties = tool.inputSchema.properties ?? {};
  if (search ? !properties.query : !properties.owner || !properties.repo) return [];
  const inputSchema: ToolDefinition["inputSchema"] = {
    type: "object",
    properties: { ...Object.fromEntries(Object.entries(properties).filter(([key]) => FIELDS.has(key))), harnessCursor: { type: "string", description: "Continuation cursor from the gateway; repeat the original arguments unchanged." } },
    required: tool.inputSchema.required,
  };
  if (inputSchema.required?.some((key) => !(key in (inputSchema.properties ?? {})))) return [];
  return [{ name: tool.name, description: tool.description ?? tool.name, inputSchema,
    access: search ? { kind: "search", resourceType: "repo" } : { kind: "resource", resourceType: "repo", extract: repository },
  }];
}
function repository(args: Record<string, unknown>): string | null {
  if (typeof args.owner !== "string" || typeof args.repo !== "string") return null;
  const repo = `${args.owner}/${args.repo}`;
  return REPO.test(repo) ? repo : null;
}
function authorized(ctx: ToolContext, name: string, args: Record<string, unknown>): boolean {
  if (Object.keys(args).some((key) => key !== "harnessCursor" && !FIELDS.has(key))) return false;
  if (args.page !== undefined && (typeof args.page !== "number" || !Number.isSafeInteger(args.page) || args.page < 1)) return false;
  if (args.perPage !== undefined && (typeof args.perPage !== "number" || !Number.isInteger(args.perPage) || args.perPage < 1 || args.perPage > 100)) return false;
  const allowed = ctx.allowedResources.repo ?? [];
  if (SEARCH.has(name)) return safeQuery(args.query, allowed);
  if (!READ.has(name)) return false;
  const repo = repository(args);
  if (!repo || !allowed.includes(repo)) return false;
  if (name !== "get_file_contents" && (typeof args.method !== "string" || !METHODS.has(args.method))) return false;
  return !Object.values(args).some((value) => typeof value === "string" && /https?:\/\//i.test(value));
}
// Conjunctions of plain terms and positive qualifiers only: unsupported syntax fails closed.
function safeQuery(query: unknown, allowed: readonly string[]): boolean {
  if (typeof query !== "string" || query.length > 2000 || !/^[A-Za-z0-9_./:#@+*=-]+(?: +[A-Za-z0-9_./:#@+*=-]+)*$/.test(query)) return false;
  const terms = query.split(/ +/);
  if (terms.some((term) => /^(OR|NOT|AND)$/i.test(term) || /^(org|user|owner):/i.test(term) || term.startsWith("-") || term.startsWith("/") || term.endsWith("/"))) return false;
  const repos = terms.filter((term) => /^repo:/i.test(term));
  return repos.length > 0 && repos.every((term) => REPO.test(term.slice(5)) && allowed.includes(term.slice(5)));
}
function error(code: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: code }) }] };
}
