import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Counter } from "@prometheus-io/client";
import { findActiveTokenUserId, findProjectForUser, listAllowedResources, listProjectResources, listUserAllowedResources } from "../../db/access.ts";
import type { AuditSink } from "../../db/audit.ts";
import type { Db } from "../../db/database.ts";
import { hashGatewayToken, isWellFormedGatewayToken } from "../../domain/gateway-token.ts";
import type { BackendRegistry, McpBackend, ToolContext } from "../../mcp/backend.ts";
import { createMcpServer } from "../../mcp/protocol.ts";

export const MCP_PATH = "/mcp/projects/:project/:server";
export const PERSONAL_MCP_PATH = "/mcp/me/:server";

export interface McpRouteDeps {
  readDb: Db;
  audit: AuditSink;
  backends: BackendRegistry;
  allowedOrigins: readonly string[];
  toolCalls: Counter<"server" | "outcome">;
}

interface McpCall {
  backend: McpBackend;
  ctx: ToolContext;
}

declare module "fastify" {
  interface FastifyRequest {
    mcpCall: McpCall | null;
  }
}

const MAX_NAME_LENGTH = 100;

// Streamable HTTP without sessions: every POST is answered on its own, as JSON.
// Checks run in this order and stop at the first failure:
// Origin (403), gateway token (401), optional project membership (404), registered server (404).
export function registerMcpRoutes(app: FastifyInstance, deps: McpRouteDeps): void {
  app.decorateRequest("mcpCall", null);

  // Authentication precedes body parsing on both routes.
  for (const [url, personal] of [[MCP_PATH, false], [PERSONAL_MCP_PATH, true]] as const) {
    app.route({
      method: "POST", url,
      onRequest: (request, reply) => authorize(deps, request, reply, personal),
      handler: (request, reply) => handleMcp(deps, request, reply),
    });
    app.route({
      method: ["GET", "DELETE"], url,
      handler: async (_request, reply) =>
        reply.code(405).header("Allow", "POST").send({ error: "method_not_allowed", message: "use POST" }),
    });
  }
}

async function authorize(deps: McpRouteDeps, request: FastifyRequest, reply: FastifyReply, personal: boolean): Promise<FastifyReply | undefined> {
  const origin = request.headers.origin;
  if (origin !== undefined && !deps.allowedOrigins.includes(origin)) {
    request.log.warn({ origin: origin.slice(0, MAX_NAME_LENGTH) }, "origin not allowed");
    return reply.code(403).send({ error: "origin_not_allowed", message: "the Origin header is not allowed" });
  }

  const userId = authenticatedUserId(deps.readDb, request);
  if (userId === undefined) {
    return reply
      .code(401)
      .header("WWW-Authenticate", "Bearer")
      .send({ error: "invalid_token", message: "send Authorization: Bearer <gateway token>" });
  }

  if (personal) return authorizePersonal(deps, request, reply, userId);

  const { project, server } = request.params as { project: string; server: string };
  const projectRef = findProjectForUser(deps.readDb, userId, project);
  if (projectRef === undefined) {
    // Same answer for a project that does not exist and one of another squad.
    deps.audit.record({
      action: "gateway.access_denied",
      actorUserId: userId,
      tenantId: null,
      correlationId: request.id,
      details: { project: project.slice(0, MAX_NAME_LENGTH), server: server.slice(0, MAX_NAME_LENGTH), reason: "project_not_found" },
    });
    return reply.code(404).send({ error: "not_found", message: "project not found" });
  }

  const backend = deps.backends.get(server);
  if (backend === undefined) {
    deps.audit.record({
      action: "gateway.access_denied",
      actorUserId: userId,
      tenantId: projectRef.tenantId,
      correlationId: request.id,
      details: { project: projectRef.slug, server: server.slice(0, MAX_NAME_LENGTH), reason: "server_not_found" },
    });
    return reply.code(404).send({ error: "not_found", message: "server not found" });
  }

  request.mcpCall = {
    backend,
    ctx: {
      userId,
      scope: "project",
      project: projectRef,
      server,
      correlationId: request.id,
      ...(server === "project" ? { projectResources: listProjectResources(deps.readDb, projectRef.id) } : {}),
      allowedResources: listAllowedResources(deps.readDb, projectRef.id, server),
    },
  };
  return undefined;
}

function authorizePersonal(deps: McpRouteDeps, request: FastifyRequest, reply: FastifyReply, userId: string): FastifyReply | undefined {
  // There is no client-selected user or tenant on this route.
  if (Object.keys(request.query as object).length > 0) {
    return reply.code(400).send({ error: "invalid_query", message: "personal MCP endpoints accept no query parameters" });
  }
  const { server } = request.params as { server: string };
  const backend = server === "project" ? undefined : deps.backends.get(server);
  if (backend === undefined) {
    deps.audit.record({ action: "gateway.access_denied", actorUserId: userId, tenantId: null,
      correlationId: request.id, details: { scope: "personal", server: server.slice(0, MAX_NAME_LENGTH), reason: "server_not_found" } });
    return reply.code(404).send({ error: "not_found", message: "server not found" });
  }
  request.mcpCall = { backend, ctx: { scope: "personal", userId, server, correlationId: request.id,
    allowedResources: listUserAllowedResources(deps.readDb, userId, server) } };
  return undefined;
}

// Shared with the model proxy: the same dev token authenticates MCP calls and model requests.
export function authenticatedUserId(readDb: Db, request: FastifyRequest): string | undefined {
  const token = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? "")?.[1];
  if (token === undefined || !isWellFormedGatewayToken(token)) return undefined;
  return findActiveTokenUserId(readDb, hashGatewayToken(token));
}

async function handleMcp(deps: McpRouteDeps, request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const { backend, ctx } = request.mcpCall as McpCall;
  const server = createMcpServer(backend, ctx, (tool, call) => {
    deps.audit.record({
      action: "gateway.tool_call",
      actorUserId: ctx.userId,
      tenantId: ctx.scope === "personal" ? null : ctx.project.tenantId,
      correlationId: ctx.correlationId,
      details: {
        ...(ctx.scope === "personal" ? { scope: "personal" } : { project: ctx.project.slug }),
        server: ctx.server,
        tool: tool.slice(0, MAX_NAME_LENGTH),
        outcome: call.outcome,
        reason: call.reason,
        resource_type: call.resourceType,
        resource_id: call.resourceId,
        resource_count: call.resourceCount,
      },
    });
    deps.toolCalls.inc({ server: ctx.server, outcome: call.outcome });
    request.log.info(
      { ...(ctx.scope === "personal" ? { scope: "personal" } : { project: ctx.project.slug }), server: ctx.server, tool: tool.slice(0, MAX_NAME_LENGTH), outcome: call.outcome, reason: call.reason },
      "tool call",
    );
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(toWebRequest(request), { parsedBody: request.body });
    reply.code(response.status);
    response.headers.forEach((value, name) => reply.header(name, value));
    return reply.send(await response.text());
  } finally {
    await server.close();
  }
}

// The transport reads only the method and the headers; the body was already parsed by Fastify.
// The Authorization header stays out of the object.
function toWebRequest(request: FastifyRequest): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (name === "authorization" || value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return new Request(`http://gateway.internal${request.url}`, { method: request.method, headers });
}
