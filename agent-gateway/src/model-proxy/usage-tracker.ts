import { StringDecoder } from "node:string_decoder";

// Reads token usage and the end state from a Messages API response while the bytes are forwarded
// untouched. It works on copies of the chunks and never writes to the stream.

export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
}

export type StreamEnd = "stopped" | "error" | "unfinished";

const USAGE_FIELDS = [
  ["input_tokens", "inputTokens"],
  ["output_tokens", "outputTokens"],
  ["cache_creation_input_tokens", "cacheCreationInputTokens"],
  ["cache_read_input_tokens", "cacheReadInputTokens"],
] as const;

// An SSE event that never ends would grow the pending text; past this size it is dropped.
const MAX_PENDING_CHARS = 4 * 1024 * 1024;
const EVENT_SEPARATOR = /\r?\n\r?\n/;

export function emptyUsage(): Usage {
  return { inputTokens: null, outputTokens: null, cacheCreationInputTokens: null, cacheReadInputTokens: null };
}

// Usage objects in the stream are cumulative: each field present replaces the previous value
// and a field that is absent keeps it. Values are never added together.
export function mergeUsage(into: Usage, source: unknown): void {
  if (typeof source !== "object" || source === null) return;
  const fields = source as Record<string, unknown>;
  for (const [wireName, name] of USAGE_FIELDS) {
    const value = fields[wireName];
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) into[name] = value;
  }
}

export class SseUsageTracker {
  readonly usage: Usage = emptyUsage();
  model: string | null = null;
  private end: StreamEnd = "unfinished";
  private pending = "";
  private readonly decoder = new StringDecoder("utf8");

  feed(chunk: Buffer): void {
    this.pending += this.decoder.write(chunk);
    const events = this.pending.split(EVENT_SEPARATOR);
    this.pending = events.pop() ?? "";
    for (const event of events) this.readEvent(event);
    if (this.pending.length > MAX_PENDING_CHARS) this.pending = "";
  }

  // Call once when the upstream body ends. The last event may lack the closing blank line.
  finish(): StreamEnd {
    this.pending += this.decoder.end();
    if (this.pending.trim() !== "") this.readEvent(this.pending);
    this.pending = "";
    return this.end;
  }

  private readEvent(text: string): void {
    const data = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (data === "") return;
    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof event !== "object" || event === null) return;
    const { type, message, usage } = event as {
      type?: unknown;
      message?: { model?: unknown; usage?: unknown };
      usage?: unknown;
    };
    if (type === "message_start") {
      if (typeof message?.model === "string") this.model = message.model;
      mergeUsage(this.usage, message?.usage);
    } else if (type === "message_delta") {
      mergeUsage(this.usage, usage);
    } else if (type === "message_stop") {
      if (this.end !== "error") this.end = "stopped";
    } else if (type === "error") {
      this.end = "error";
    }
  }
}

// Non-streaming responses: the whole JSON body carries model and usage.
export function readJsonUsage(body: Buffer): { usage: Usage; model: string | null } {
  const usage = emptyUsage();
  try {
    const parsed = JSON.parse(body.toString("utf8")) as { model?: unknown; usage?: unknown };
    mergeUsage(usage, parsed.usage);
    return { usage, model: typeof parsed.model === "string" ? parsed.model : null };
  } catch {
    return { usage, model: null };
  }
}
