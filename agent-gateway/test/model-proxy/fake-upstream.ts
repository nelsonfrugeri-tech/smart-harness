// A local HTTP server that plays the model provider, so the proxy tests never use the network.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface ReceivedRequest {
  url: string;
  headers: IncomingMessage["headers"];
  body: Buffer;
}

export type UpstreamHandler = (request: ReceivedRequest, response: ServerResponse) => void | Promise<void>;

export interface FakeUpstream {
  url: string;
  requests: ReceivedRequest[];
  // Replaces the behavior for the next requests.
  handle(handler: UpstreamHandler): void;
  close(): Promise<void>;
}

export async function startFakeUpstream(): Promise<FakeUpstream> {
  const requests: ReceivedRequest[] = [];
  let handler: UpstreamHandler = (_request, response) => void response.writeHead(500).end();
  const server: Server = createServer((incoming, response) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      const received = { url: incoming.url ?? "", headers: incoming.headers, body: Buffer.concat(chunks) };
      requests.push(received);
      void handler(received, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    handle: (next) => {
      handler = next;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

// One SSE event as the Messages API writes it.
export function sseEvent(type: string, data: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
}

export const SSE_HEADERS = { "content-type": "text/event-stream", "cache-control": "no-cache" };

// The official web search example: input starts at 2,679 and ends at 10,682 in message_delta.
export const WEB_SEARCH_STREAM: string[] = [
  sseEvent("message_start", {
    message: {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-test-model",
      content: [],
      usage: { input_tokens: 2679, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 3 },
    },
  }),
  "event: ping\ndata: {\"type\": \"ping\"}\n\n",
  sseEvent("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
  sseEvent("content_block_delta", { index: 0, delta: { type: "text_delta", text: "OK" } }),
  sseEvent("content_block_stop", { index: 0 }),
  sseEvent("message_delta", {
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { input_tokens: 10682, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 510 },
  }),
  sseEvent("message_stop", {}),
];
