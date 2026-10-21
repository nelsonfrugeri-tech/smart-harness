import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpBackend, ToolAccess, ToolDefinition } from "../mcp/backend.ts";
import { MAX_RESPONSE_CHARS } from "../mcp/limits.ts";
import { errorResult, jsonResult, textResult, ToolError, withToolErrors } from "../mcp/result.ts";

// GitHub through the official remote MCP server (https://api.githubcopilot.com/mcp/).
// The gateway exposes a fixed read-only set of its tools, checks the repository, injects GITHUB_TOKEN
// and forwards the call. The developer never sees the token. The resource type "repo" is permitted
// per project in gateway_permissions (server "github"), written as lowercase "owner/repo".
// search_repositories, user, team and organization tools are not exposed.

export interface GithubOptions {
  mcpUrl: string;
  token: string;
}

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const UPSTREAM_TIMEOUT_MS = 20_000;

function repoOfArgs(args: Record<string, unknown>): string | null {
  const { owner, repo } = args;
  if (typeof owner !== "string" || typeof repo !== "string" || !NAME.test(owner) || !NAME.test(repo)) return null;
  return `${owner}/${repo}`.toLowerCase();
}

// Search tools receive only a query, so the query itself must pin the search to one repository:
// exactly one `repo:owner/name` qualifier and nothing that can widen the scope (org:, user:, OR,
// NOT, negation, parentheses). Text inside "quoted phrases" is not a qualifier and is ignored.
const SCOPE_QUALIFIER = /^-?(repo|org|user|owner|enterprise|team):/i;
const REPO_QUALIFIER = /^repo:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/i;

export function repoOfQuery(query: unknown): string | null {
  if (typeof query !== "string") return null;
  const unquoted = query.replace(/"[^"]*"/g, " ");
  if (/["()]/.test(unquoted)) return null;
  let repo: string | null = null;
  for (const token of unquoted.split(/\s+/)) {
    if (token === "OR" || token === "NOT") return null;
    if (!SCOPE_QUALIFIER.test(token)) continue;
    if (repo !== null) return null; // a second scope qualifier
    const found: string | undefined = REPO_QUALIFIER.exec(token)?.[1];
    if (found === undefined) return null;
    repo = found.toLowerCase();
  }
  return repo;
}

interface GithubTool extends ToolDefinition {
  // The only arguments forwarded upstream.
  forwarded: string[];
  access: ToolAccess & { kind: "resource" };
}

const REPO = { owner: { type: "string" }, repo: { type: "string" } };
const PAGING = { page: { type: "number" }, perPage: { type: "number" } };

function repoTool(name: string, description: string, extra: Record<string, unknown>, required: string[]): GithubTool {
  const properties = { ...REPO, ...extra };
  return {
    name,
    description: `${description} Acts on one repository, which must be allowed for the project.`,
    inputSchema: { type: "object", properties, required: ["owner", "repo", ...required] },
    forwarded: Object.keys(properties),
    access: { kind: "resource", resourceType: "repo", extract: repoOfArgs },
  };
}

function searchTool(name: string, description: string, extra: Record<string, unknown>): GithubTool {
  const properties = { query: { type: "string", description: "Must contain exactly one repo:<owner>/<repo> of an allowed repository." }, ...extra, ...PAGING };
  return {
    name,
    description,
    inputSchema: { type: "object", properties, required: ["query"] },
    forwarded: Object.keys(properties),
    access: { kind: "resource", resourceType: "repo", extract: (args) => repoOfQuery(args.query) },
  };
}

const SORT_ORDER = { sort: { type: "string" }, order: { type: "string" } };

const TOOLS: GithubTool[] = [
  repoTool("get_file_contents", "Reads a file or lists a directory.", { path: { type: "string" }, ref: { type: "string" }, sha: { type: "string" } }, []),
  repoTool("list_commits", "Lists commits.", { sha: { type: "string" }, path: { type: "string" }, author: { type: "string" }, ...PAGING }, []),
  repoTool("get_commit", "Reads one commit.", { sha: { type: "string" }, ...PAGING }, ["sha"]),
  repoTool("list_branches", "Lists branches.", PAGING, []),
  repoTool("list_issues", "Lists issues.", { state: { type: "string" }, labels: { type: "array", items: { type: "string" } }, perPage: { type: "number" }, after: { type: "string" } }, []),
  repoTool(
    "issue_read",
    "Reads an issue (method get, get_comments, get_labels).",
    { issue_number: { type: "number" }, method: { type: "string" }, ...PAGING },
    ["method", "issue_number"],
  ),
  repoTool("list_pull_requests", "Lists pull requests.", { state: { type: "string" }, head: { type: "string" }, base: { type: "string" }, ...PAGING }, []),
  repoTool(
    "pull_request_read",
    "Reads a pull request (method get, get_diff, get_files, get_comments, get_reviews, ...).",
    { pullNumber: { type: "number" }, method: { type: "string" }, ...PAGING },
    ["method", "pullNumber"],
  ),
  searchTool("search_code", "Searches code in one allowed repository.", SORT_ORDER),
  searchTool("search_commits", "Searches commits in one allowed repository.", SORT_ORDER),
  searchTool("search_issues", "Searches issues in one allowed repository.", SORT_ORDER),
  searchTool("search_pull_requests", "Searches pull requests in one allowed repository.", SORT_ORDER),
];

export function githubBackend(options: GithubOptions): McpBackend {
  return {
    server: "github",
    listTools: () => TOOLS.map(({ name, description, inputSchema, access }) => ({ name, description, inputSchema, access })),
    callTool: (_ctx, name, args) =>
      withToolErrors(async () => {
        const tool = TOOLS.find((candidate) => candidate.name === name);
        if (tool === undefined) throw new ToolError(`Unknown tool ${name}.`);
        const forwarded = Object.fromEntries(tool.forwarded.flatMap((key) => (key in args ? [[key, args[key]]] : [])));
        const upstream = await callUpstream(options, name, forwarded);
        return limitText(upstream, `${name}:${tool.access.extract(args) ?? ""}`);
      }),
  };
}

// One short-lived MCP session per call. X-MCP-Readonly asks the server to hide every write tool.
async function callUpstream(options: GithubOptions, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const client = new Client({ name: "smart-harness-gateway", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(options.mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${options.token}`, "X-MCP-Readonly": "true" } },
  });
  try {
    await client.connect(transport, { timeout: UPSTREAM_TIMEOUT_MS });
    return (await client.callTool({ name, arguments: args }, undefined, { timeout: UPSTREAM_TIMEOUT_MS })) as CallToolResult;
  } catch {
    throw new ToolError("GitHub MCP is unreachable or refused the call.");
  } finally {
    await client.close().catch(() => undefined);
  }
}

// Upstream pagination (page, perPage) is the way to read more. A text above the limit is cut and
// wrapped in valid JSON that keeps an id and the source, like the gateway's own objects.
function limitText(result: CallToolResult, id: string): CallToolResult {
  const parts = Array.isArray(result.content) ? result.content : [];
  // get_file_contents answers with a text note plus an embedded resource that holds the file text.
  const text = parts
    .map((part) => (part.type === "text" ? part.text : part.type === "resource" && "text" in part.resource ? part.resource.text : ""))
    .filter((piece) => piece !== "")
    .join("\n");
  if (result.isError === true) return errorResult(text.slice(0, MAX_RESPONSE_CHARS));
  if (text.length <= MAX_RESPONSE_CHARS) return textResult(text);
  let keep = MAX_RESPONSE_CHARS - 300;
  for (;;) {
    const wrapped = { id, source: "github", truncated: true, total_chars: text.length, content: text.slice(0, keep) };
    if (keep <= 0 || JSON.stringify(wrapped).length <= MAX_RESPONSE_CHARS) return jsonResult(wrapped);
    keep = Math.floor(keep / 2);
  }
}
