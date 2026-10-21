import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// A failure whose message is written by the gateway (never copied from an upstream body, URL or
// argument), so it is safe to show to the developer. Any other error becomes a generic message.
export class ToolError extends Error {}

export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

export function jsonResult(value: unknown): CallToolResult {
  return textResult(JSON.stringify(value));
}

export function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}

// Runs a tool and turns a ToolError into an error result. Other errors propagate to the gateway,
// which answers with a generic message and audits the call as an error.
export async function withToolErrors(run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ToolError) return errorResult(error.message);
    throw error;
  }
}
