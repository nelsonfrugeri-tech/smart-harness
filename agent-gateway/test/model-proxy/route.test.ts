import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFixture, DEV, DEV_CARTOES, type Fixture } from "../test-support.ts";
import { SSE_HEADERS, WEB_SEARCH_STREAM, sseEvent, startFakeUpstream, type FakeUpstream } from "./fake-upstream.ts";

const UPSTREAM_KEY = "sk-or-test-upstream-key-0123456789";
const PROMPT = "PROMPT-TEXT-THAT-MUST-NOT-BE-STORED";
const REQUEST = { model: "anthropic/claude-test", max_tokens: 16, stream: true, messages: [{ role: "user", content: PROMPT }] };

describe("model proxy: POST /v1/messages", () => {
  let upstream: FakeUpstream;
  let fixture: Fixture;
  let devToken: string;
  const logs: string[] = [];

  beforeAll(async () => {
    upstream = await startFakeUpstream();
    fixture = await createFixture({
      modelProxy: { upstream: { url: upstream.url, key: UPSTREAM_KEY } },
      logStream: { write: (line) => void logs.push(line) },
    });
    devToken = fixture.token(DEV);
  });
  afterAll(async () => {
    await fixture.close();
    await upstream.close();
  });
  beforeEach(() => {
    fixture.apiDb.exec("DELETE FROM model_usage");
    upstream.requests.length = 0;
  });

  function call(body: unknown = REQUEST, headers: Record<string, string> = {}, path = "/v1/messages"): Promise<Response> {
    return fetch(`${fixture.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${devToken}`, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  function serveStream(chunks: string[]): void {
    upstream.handle(async (_request, response) => {
      response.writeHead(200, SSE_HEADERS);
      for (const chunk of chunks) {
        response.write(chunk);
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      response.end();
    });
  }

  it("forwards the stream byte for byte and records the last cumulative usage once", async () => {
    serveStream(WEB_SEARCH_STREAM);

    const response = await call();
    const received = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(received.equals(Buffer.from(WEB_SEARCH_STREAM.join("")))).toBe(true);
    const rows = fixture.usageRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      harness: "node",
      model: "claude-test-model",
      input_tokens: 10682,
      output_tokens: 510,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      http_status: 200,
      outcome: "ok",
      project_id: null,
    });
    expect(rows[0]?.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("swaps the dev token for the provider key and sends nothing else that identifies the dev", async () => {
    serveStream(WEB_SEARCH_STREAM);

    await (
      await call(REQUEST, { "x-api-key": "dev-api-key", cookie: "a=b", "anthropic-version": "2023-06-01", "anthropic-beta": "x-beta" })
    ).arrayBuffer();

    const sent = upstream.requests[0];
    expect(sent?.headers.authorization).toBe(`Bearer ${UPSTREAM_KEY}`);
    expect(sent?.headers["x-api-key"]).toBeUndefined();
    expect(sent?.headers.cookie).toBeUndefined();
    expect(sent?.headers["anthropic-version"]).toBe("2023-06-01");
    expect(sent?.headers["anthropic-beta"]).toBe("x-beta");
    expect(JSON.stringify(sent?.headers)).not.toContain(devToken);
    expect(sent?.body.toString()).toBe(JSON.stringify(REQUEST));
    expect(sent?.url).toBe("/v1/messages");
  });

  it("keeps the query string of the request", async () => {
    serveStream(WEB_SEARCH_STREAM);

    await (await call(REQUEST, {}, "/v1/messages?beta=true")).arrayBuffer();

    expect(upstream.requests[0]?.url).toBe("/v1/messages?beta=true");
  });

  it("records usage when events are split across chunks", async () => {
    const all = Buffer.from(WEB_SEARCH_STREAM.join(""));
    serveStream([all.subarray(0, 50).toString("latin1"), all.subarray(50, 333).toString("latin1"), all.subarray(333).toString("latin1")]);

    await (await call()).arrayBuffer();

    expect(fixture.usageRows()[0]).toMatchObject({ input_tokens: 10682, output_tokens: 510, outcome: "ok" });
  });

  it("records stream_error for an SSE error event after HTTP 200 and still forwards the bytes", async () => {
    const chunks = [
      sseEvent("message_start", { message: { model: "m", usage: { input_tokens: 40, output_tokens: 1 } } }),
      sseEvent("error", { error: { type: "overloaded_error", message: "Overloaded" } }),
    ];
    serveStream(chunks);

    const response = await call();
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toBe(chunks.join(""));
    const rows = fixture.usageRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: "stream_error", http_status: 200, input_tokens: 40 });
  });

  it("records incomplete when the stream ends without message_stop", async () => {
    serveStream(WEB_SEARCH_STREAM.slice(0, 4));

    await (await call()).arrayBuffer();

    expect(fixture.usageRows()).toHaveLength(1);
    expect(fixture.usageRows()[0]).toMatchObject({ outcome: "incomplete", input_tokens: 2679 });
  });

  it("records incomplete when the provider drops the connection in the middle of the stream", async () => {
    upstream.handle(async (_request, response) => {
      response.writeHead(200, SSE_HEADERS);
      response.write(WEB_SEARCH_STREAM[0] as string);
      await new Promise((resolve) => setTimeout(resolve, 20));
      response.destroy();
    });

    const response = await call();
    await response.arrayBuffer().catch(() => undefined);

    await vi.waitFor(() => expect(fixture.usageRows()).toHaveLength(1));
    expect(fixture.usageRows()[0]).toMatchObject({ outcome: "incomplete", input_tokens: 2679 });
  });

  it("records incomplete once when the client leaves before the end", async () => {
    upstream.handle(async (_request, response) => {
      response.writeHead(200, SSE_HEADERS);
      response.write(WEB_SEARCH_STREAM[0] as string);
      await new Promise((resolve) => setTimeout(resolve, 300));
      response.end(WEB_SEARCH_STREAM.slice(1).join(""));
    });

    const response = await call();
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    await reader.cancel();

    await vi.waitFor(() => expect(fixture.usageRows()).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(fixture.usageRows()).toHaveLength(1);
    expect(fixture.usageRows()[0]).toMatchObject({ outcome: "incomplete" });
  });

  it("forwards a non-streaming response and records its usage", async () => {
    const body = JSON.stringify({ id: "msg", model: "claude-json", content: [], usage: { input_tokens: 12, output_tokens: 3 } });
    upstream.handle((_request, response) => void response.writeHead(200, { "content-type": "application/json" }).end(body));

    const response = await call({ ...REQUEST, stream: false });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(body);
    expect(fixture.usageRows()[0]).toMatchObject({ model: "claude-json", input_tokens: 12, output_tokens: 3, outcome: "ok" });
  });

  it("passes a provider error through and records upstream_error with the request's model", async () => {
    const body = JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow down" } });
    upstream.handle((_request, response) => void response.writeHead(429, { "content-type": "application/json" }).end(body));

    const response = await call();

    expect(response.status).toBe(429);
    expect(await response.text()).toBe(body);
    expect(fixture.usageRows()[0]).toMatchObject({
      outcome: "upstream_error",
      http_status: 429,
      model: "anthropic/claude-test",
      input_tokens: null,
    });
  });

  it("answers 502 when the provider rejects the gateway key, without leaking the provider answer", async () => {
    upstream.handle((_request, response) => void response.writeHead(401, { "content-type": "application/json" }).end('{"leak":"yes"}'));

    const response = await call();
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(text).not.toContain("leak");
    expect(text).not.toContain(UPSTREAM_KEY);
    expect(fixture.usageRows()[0]).toMatchObject({ outcome: "upstream_error", http_status: 502 });
  });

  it("does not follow a redirect with the provider key", async () => {
    upstream.handle((_request, response) => void response.writeHead(302, { location: "http://127.0.0.1:1/steal" }).end());

    const response = await call();

    expect(response.status).toBe(502);
    expect(response.headers.get("location")).toBeNull();
  });

  it("answers 502 and records unreachable when the provider does not answer", async () => {
    const down = await startFakeUpstream();
    const url = down.url;
    await down.close();
    const broken = await createFixture({ modelProxy: { upstream: { url, key: UPSTREAM_KEY } } });
    const token = broken.token(DEV);

    const response = await fetch(`${broken.baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(REQUEST),
    });

    expect(response.status).toBe(502);
    expect(broken.usageRows()).toHaveLength(1);
    expect(broken.usageRows()[0]).toMatchObject({ outcome: "unreachable", http_status: 502, model: "anthropic/claude-test" });
    await broken.close();
  });

  it("answers 401 for a missing, malformed or revoked token and never calls the provider or records usage", async () => {
    const revoked = fixture.token(DEV_CARTOES);
    fixture.revokeAll(DEV_CARTOES);

    const none = await fetch(`${fixture.baseUrl}/v1/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const malformed = await call(REQUEST, { authorization: "Bearer nope" });
    const gone = await call(REQUEST, { authorization: `Bearer ${revoked}` });

    for (const response of [none, malformed, gone]) {
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe("Bearer");
      expect(await response.json()).toMatchObject({ type: "error", error: { type: "authentication_error" } });
    }
    expect(upstream.requests).toHaveLength(0);
    expect(fixture.usageRows()).toHaveLength(0);
  });

  it("never stores or logs the prompt, the provider key or the dev token", async () => {
    serveStream(WEB_SEARCH_STREAM);
    upstream.handle((_request, response) => void response.writeHead(401).end());
    await (await call()).arrayBuffer();
    serveStream(WEB_SEARCH_STREAM);
    await (await call()).arrayBuffer();

    const stored = JSON.stringify([fixture.usageRows(), fixture.auditRows()]);
    const logged = logs.join("\n");
    expect(logged).toContain("model request");
    for (const secret of [PROMPT, UPSTREAM_KEY]) {
      expect(stored).not.toContain(secret);
      expect(logged).not.toContain(secret);
    }
    expect(stored).not.toContain(devToken);
    expect(logged).not.toContain(devToken);
  });

  it("names the harness from the user agent", async () => {
    serveStream(WEB_SEARCH_STREAM);

    await (await call(REQUEST, { "user-agent": "claude-cli/2.1.305 (external, cli)" })).arrayBuffer();

    expect(fixture.usageRows()[0]).toMatchObject({ harness: "claude-code" });
  });

  it("records the project only when it is a project of the caller's squad", async () => {
    serveStream(WEB_SEARCH_STREAM);

    await (await call(REQUEST, { "x-smart-harness-project": "investimentos-api" })).arrayBuffer();
    await (await call(REQUEST, { "x-smart-harness-project": "not-a-project" })).arrayBuffer();

    const [known, unknown] = fixture.usageRows();
    expect(known?.project_id).not.toBeNull();
    expect(known?.tenant_id).not.toBeNull();
    expect(unknown).toMatchObject({ project_id: null, tenant_id: null });
  });

  it("answers 503 when the provider key is not configured", async () => {
    const off = await createFixture({ modelProxy: { upstream: undefined } });
    const token = off.token(DEV);

    const response = await fetch(`${off.baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: "{}",
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ type: "error", error: { type: "api_error" } });
    await off.close();
  });
});
