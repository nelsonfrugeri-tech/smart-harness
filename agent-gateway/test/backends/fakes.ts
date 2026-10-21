// Local HTTP servers that play the upstream systems. They listen on 127.0.0.1 with a random port
// and record what the gateway sent, so tests can prove credentials were injected and nothing else leaked.
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
}

export interface FakeServer {
  url: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

async function listen(server: HttpServer): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function closer(server: HttpServer): () => Promise<void> {
  return () =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
}

export type RestAnswer = { status?: number; body: unknown };

// A REST API: `answer` receives the path and query of each request and returns the JSON to send.
export async function startFakeRest(answer: (path: string, request: RecordedRequest) => RestAnswer): Promise<FakeServer> {
  const requests: RecordedRequest[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const recorded = { method: req.method ?? "", url: req.url ?? "", headers: req.headers };
    requests.push(recorded);
    const { status = 200, body } = answer(recorded.url, recorded);
    res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
  });
  return { url: await listen(server), requests, close: closer(server) };
}

export interface FakeMcpCall {
  name: string;
  args: Record<string, unknown>;
  authorization: string | undefined;
  readonly: string | undefined;
}

export interface FakeMcp extends FakeServer {
  calls: FakeMcpCall[];
}

// An MCP server over Streamable HTTP (stateless), like the GitHub remote MCP. `tools` answer by name.
export async function startFakeMcp(tools: Record<string, (args: Record<string, unknown>) => CallToolResult>): Promise<FakeMcp> {
  const requests: RecordedRequest[] = [];
  const calls: FakeMcpCall[] = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers });
    const mcp = new Server({ name: "fake-github", version: "0" }, { capabilities: { tools: {} } });
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: Object.keys(tools).map((name) => ({ name, inputSchema: { type: "object" as const } })),
    }));
    mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
      const args = request.params.arguments ?? {};
      calls.push({
        name: request.params.name,
        args,
        authorization: req.headers.authorization,
        readonly: req.headers["x-mcp-readonly"] as string | undefined,
      });
      const tool = tools[request.params.name];
      return tool === undefined ? { isError: true, content: [{ type: "text", text: "unknown tool" }] } : tool(args);
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => void transport.close());
    void mcp.connect(transport).then(() => transport.handleRequest(req, res));
  });
  return { url: `${await listen(server)}/mcp/`, requests, calls, close: closer(server) };
}
