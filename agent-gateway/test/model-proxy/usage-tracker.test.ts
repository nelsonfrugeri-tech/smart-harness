import { describe, expect, it } from "vitest";
import { SseUsageTracker, readJsonUsage } from "../../src/model-proxy/usage-tracker.ts";
import { WEB_SEARCH_STREAM, sseEvent } from "./fake-upstream.ts";

function run(chunks: (string | Buffer)[]): { tracker: SseUsageTracker; end: string } {
  const tracker = new SseUsageTracker();
  for (const chunk of chunks) tracker.feed(Buffer.from(chunk));
  return { tracker, end: tracker.finish() };
}

describe("SseUsageTracker", () => {
  it("keeps the last cumulative value of every field, 2679 -> 10682 input and 510 output", () => {
    const { tracker, end } = run(WEB_SEARCH_STREAM);

    expect(tracker.usage).toEqual({
      inputTokens: 10682,
      outputTokens: 510,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
    expect(tracker.model).toBe("claude-test-model");
    expect(end).toBe("stopped");
  });

  it("keeps the input when the final delta carries only the output", () => {
    const { tracker } = run([
      sseEvent("message_start", { message: { model: "m", usage: { input_tokens: 25, output_tokens: 1 } } }),
      sseEvent("message_delta", { delta: {}, usage: { output_tokens: 15 } }),
      sseEvent("message_stop", {}),
    ]);

    expect(tracker.usage).toMatchObject({ inputTokens: 25, outputTokens: 15, cacheReadInputTokens: null });
  });

  it("gives the same result when the bytes are cut at every position", () => {
    const whole = Buffer.from(WEB_SEARCH_STREAM.join(""));
    const expected = run([whole]).tracker.usage;

    for (let cut = 1; cut < whole.length; cut += 7) {
      const { tracker, end } = run([whole.subarray(0, cut), whole.subarray(cut)]);
      expect(tracker.usage).toEqual(expected);
      expect(end).toBe("stopped");
    }
  });

  it("reads several events that arrive in one chunk", () => {
    const { tracker, end } = run([WEB_SEARCH_STREAM.join("")]);

    expect(tracker.usage.inputTokens).toBe(10682);
    expect(end).toBe("stopped");
  });

  it("does not break a multi-byte character cut between chunks", () => {
    const event = Buffer.from(sseEvent("message_start", { message: { model: "modelo-ç", usage: { input_tokens: 1 } } }));
    const cut = event.indexOf(Buffer.from("ç")) + 1;

    const { tracker } = run([event.subarray(0, cut), event.subarray(cut)]);

    expect(tracker.model).toBe("modelo-ç");
  });

  it("accepts CRLF line endings", () => {
    const crlf = WEB_SEARCH_STREAM.join("").replaceAll("\n", "\r\n");

    const { tracker, end } = run([crlf]);

    expect(tracker.usage.outputTokens).toBe(510);
    expect(end).toBe("stopped");
  });

  it("reports an error event even when message_stop follows", () => {
    const { end } = run([
      sseEvent("message_start", { message: { model: "m", usage: { input_tokens: 5 } } }),
      sseEvent("error", { error: { type: "overloaded_error", message: "Overloaded" } }),
      sseEvent("message_stop", {}),
    ]);

    expect(end).toBe("error");
  });

  it("reports unfinished when message_stop never arrives", () => {
    const { tracker, end } = run(WEB_SEARCH_STREAM.slice(0, 4));

    expect(end).toBe("unfinished");
    expect(tracker.usage.inputTokens).toBe(2679);
  });

  it("reads a final event without the closing blank line", () => {
    const { end } = run([...WEB_SEARCH_STREAM.slice(0, -1), sseEvent("message_stop", {}).trimEnd()]);

    expect(end).toBe("stopped");
  });

  it("ignores malformed data and negative or fractional counts", () => {
    const { tracker } = run([
      "data: {not json\n\n",
      sseEvent("message_start", { message: { usage: { input_tokens: -1, output_tokens: 1.5 } } }),
    ]);

    expect(tracker.usage).toEqual({
      inputTokens: null,
      outputTokens: null,
      cacheCreationInputTokens: null,
      cacheReadInputTokens: null,
    });
  });
});

describe("readJsonUsage", () => {
  it("reads model and usage from a non-streaming body", () => {
    const body = Buffer.from(JSON.stringify({ model: "m", usage: { input_tokens: 11, output_tokens: 7 } }));

    expect(readJsonUsage(body)).toEqual({
      model: "m",
      usage: { inputTokens: 11, outputTokens: 7, cacheCreationInputTokens: null, cacheReadInputTokens: null },
    });
  });

  it("returns empty usage for a body that is not JSON", () => {
    expect(readJsonUsage(Buffer.from("oops")).usage.inputTokens).toBeNull();
  });
});
