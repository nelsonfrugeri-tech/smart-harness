import { Readable, Transform, pipeline } from "node:stream";
import type { ReadableStream } from "node:stream/web";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { findProjectForUser } from "../db/access.ts";
import type { Db } from "../db/database.ts";
import { authenticatedUserId } from "../http/routes/mcp.ts";
import type { ModelUpstream } from "./config.ts";
import type { ModelOutcome, ModelUsageSink } from "./usage-sink.ts";
import { SseUsageTracker, emptyUsage, readJsonUsage, type Usage } from "./usage-tracker.ts";

export const MESSAGES_PATH = "/v1/messages";
export const PROJECT_HEADER = "x-smart-harness-project";

export interface ModelProxyDeps {
  readDb: Db;
  usage: ModelUsageSink;
  // Undefined when MODEL_UPSTREAM_KEY is not set.
  upstream: ModelUpstream | undefined;
}

// Claude Code requests carry the whole conversation, so the body limit is generous.
const BODY_LIMIT_BYTES = 32 * 1024 * 1024;
// A non-streaming response is read whole to find its usage; larger bodies are forwarded without usage.
const MAX_JSON_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_NAME_LENGTH = 64;

// The only request headers sent upstream. Authorization is built by the gateway; x-api-key,
// cookies and the dev token never leave.
const FORWARDED_REQUEST_HEADERS = ["content-type", "accept", "anthropic-version", "anthropic-beta", "user-agent"];
// Response headers the gateway must not copy: hop-by-hop ones, framing that fetch already
// decoded, cookies and redirects.
const DROPPED_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-length",
  "content-encoding",
  "set-cookie",
  "location",
]);

const callers = new WeakMap<FastifyRequest, string>();

// Forwards POST /v1/messages (Anthropic Messages API) to the configured upstream and records usage.
// Order of checks: gateway token (401), upstream configured (503). The response body is forwarded
// byte for byte; a copy of each chunk feeds the usage tracker.
export function registerModelProxyRoute(app: FastifyInstance, deps: ModelProxyDeps): void {
  // A separate scope keeps the raw-body JSON parser away from the other routes.
  void app.register(async (scope) => {
    // Raw bytes: the body is forwarded as received, and the proxy only reads "model" from it.
    scope.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: BODY_LIMIT_BYTES }, (_request, body, done) =>
      done(null, body),
    );
    scope.route({
      method: "POST",
      url: MESSAGES_PATH,
      bodyLimit: BODY_LIMIT_BYTES,
      // Before the body is read, so an unauthenticated caller cannot make the gateway buffer it.
      onRequest: (request, reply) => authorize(deps, request, reply),
      handler: (request, reply) => forward(deps, request, reply),
    });
  });
}

async function authorize(deps: ModelProxyDeps, request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
  const userId = authenticatedUserId(deps.readDb, request);
  if (userId === undefined) {
    return reply
      .code(401)
      .header("WWW-Authenticate", "Bearer")
      .send(errorBody("authentication_error", "send Authorization: Bearer <gateway token>"));
  }
  if (deps.upstream === undefined) {
    request.log.warn("model proxy called but MODEL_UPSTREAM_KEY is not set");
    return reply.code(503).send(errorBody("api_error", "the model proxy is not configured"));
  }
  callers.set(request, userId);
  return undefined;
}

async function forward(deps: ModelProxyDeps, request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const startedAt = performance.now();
  const userId = callers.get(request) as string;
  const upstream = deps.upstream as ModelUpstream;
  const body = request.body as Buffer;
  const project = projectFor(deps.readDb, userId, request);

  let recorded = false;
  const record = (outcome: ModelOutcome, httpStatus: number, model: string | null, usage: Usage): void => {
    if (recorded) return;
    recorded = true;
    const durationMs = Math.round(performance.now() - startedAt);
    const entry = {
      userId,
      tenantId: project?.tenantId ?? null,
      projectId: project?.id ?? null,
      correlationId: request.id,
      harness: harnessName(request.headers["user-agent"]),
      model: model ?? requestedModel(body),
      usage,
      httpStatus,
      outcome,
      durationMs,
    };
    try {
      deps.usage.record(entry);
    } catch (error) {
      request.log.error({ error: errorName(error) }, "model usage record failed");
    }
    request.log.info({ model: entry.model, outcome, http_status: httpStatus, duration_ms: durationMs, ...usage }, "model request");
  };

  const aborted = new AbortController();
  reply.raw.on("close", () => {
    if (!reply.raw.writableFinished) aborted.abort();
  });

  let response: Response;
  try {
    response = await fetch(`${upstream.url}${request.url}`, {
      method: "POST",
      headers: upstreamHeaders(request, upstream.key),
      body: new Uint8Array(body),
      // A redirect would send the provider key to another host.
      redirect: "manual",
      signal: aborted.signal,
    });
  } catch (error) {
    // The error text is not logged: it can echo the URL. The name is enough to tell timeout from refusal.
    request.log.warn({ error: errorName(error) }, "model upstream unreachable");
    record("unreachable", 502, null, emptyUsage());
    return reply.code(502).send(errorBody("api_error", "the model upstream is unreachable"));
  }

  // The provider rejected the gateway's own credentials or redirected: the dev must not see that
  // as an invalid dev token, and the dev has no use for the provider's answer.
  if (response.status === 401 || response.status === 403 || (response.status >= 300 && response.status < 400)) {
    await response.body?.cancel();
    request.log.error({ upstream_status: response.status }, "model upstream refused the gateway credentials");
    record("upstream_error", 502, null, emptyUsage());
    return reply.code(502).send(errorBody("api_error", "the model upstream refused the gateway credentials"));
  }

  reply.code(response.status);
  response.headers.forEach((value, name) => {
    if (!DROPPED_RESPONSE_HEADERS.has(name)) reply.header(name, value);
  });
  if (response.body === null) {
    record(response.ok ? "ok" : "upstream_error", response.status, null, emptyUsage());
    return reply.send();
  }

  const observer = createObserver(response, (outcome, model, usage) => record(outcome, response.status, model, usage));
  // A broken connection (upstream or client) destroys the stream before its end.
  pipeline(Readable.fromWeb(response.body as ReadableStream), observer.stream, (error) => {
    if (error !== null && error !== undefined) observer.broken();
  });
  return reply.send(observer.stream);
}

interface Observer {
  stream: Transform;
  // The pipeline failed or was cut before the end of the body.
  broken(): void;
}

// A pass-through stream: every chunk goes on unchanged while a copy feeds the tracker.
// The record is written when the upstream body ends, before the last byte reaches the client.
function createObserver(response: Response, done: (outcome: ModelOutcome, model: string | null, usage: Usage) => void): Observer {
  const streaming = (response.headers.get("content-type") ?? "").toLowerCase().startsWith("text/event-stream");
  const sse = new SseUsageTracker();
  const chunks: Buffer[] = [];
  let size = 0;
  let overflow = false;

  const read = (chunk: Buffer): void => {
    if (streaming) {
      sse.feed(chunk);
    } else if (!overflow) {
      size += chunk.length;
      if (size > MAX_JSON_RESPONSE_BYTES) overflow = true;
      else chunks.push(chunk);
    }
  };

  const finish = (cut: boolean): void => {
    if (!response.ok) return done("upstream_error", null, streaming ? sse.usage : emptyUsage());
    if (streaming) {
      const end = sse.finish();
      const outcome: ModelOutcome = cut || end === "unfinished" ? "incomplete" : end === "error" ? "stream_error" : "ok";
      return done(outcome, sse.model, sse.usage);
    }
    const parsed = overflow ? { usage: emptyUsage(), model: null } : readJsonUsage(Buffer.concat(chunks));
    done(cut ? "incomplete" : "ok", parsed.model, parsed.usage);
  };

  const stream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      read(chunk);
      callback(null, chunk);
    },
    flush(callback) {
      finish(false);
      callback();
    },
  });
  return { stream, broken: () => finish(true) };
}

function upstreamHeaders(request: FastifyRequest, key: string): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers[name];
    if (typeof value === "string") headers.set(name, value);
  }
  headers.set("authorization", `Bearer ${key}`);
  return headers;
}

function projectFor(db: Db, userId: string, request: FastifyRequest): { id: string; tenantId: string } | undefined {
  const slug = request.headers[PROJECT_HEADER];
  return typeof slug === "string" ? findProjectForUser(db, userId, slug) : undefined;
}

// "claude-cli/2.1.305 (external, cli)" -> "claude-code"; any other agent keeps its product name.
function harnessName(userAgent: string | undefined): string {
  const product = (userAgent ?? "").split(/[/\s]/)[0]?.toLowerCase().replace(/[^a-z0-9._-]/g, "") ?? "";
  if (product === "claude-cli" || product.startsWith("claude-code")) return "claude-code";
  return product === "" ? "unknown" : product.slice(0, MAX_NAME_LENGTH);
}

// Only the model name is read from the request; the prompt is never kept.
function requestedModel(body: Buffer): string | null {
  try {
    const { model } = JSON.parse(body.toString("utf8")) as { model?: unknown };
    return typeof model === "string" && model.length > 0 ? model.slice(0, 200) : null;
  } catch {
    return null;
  }
}

function errorBody(type: string, message: string): { type: "error"; error: { type: string; message: string } } {
  return { type: "error", error: { type, message } };
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}
