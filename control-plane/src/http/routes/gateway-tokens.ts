import type { FastifyInstance } from "fastify";
import { recordAuditEvent } from "../../db/repos/audit.ts";
import {
  insertGatewayToken,
  listGatewayTokens,
  revokeGatewayToken,
  type GatewayTokenRecord,
} from "../../db/repos/gateway-tokens.ts";
import { generateGatewayToken } from "../../domain/gateway-token.ts";
import { authenticate, type AuthDeps } from "../auth.ts";
import { decodeTimeCursor, pageQuerySchema, toPage, type Page } from "../pagination.ts";
import { notFound } from "../problem.ts";

export interface GatewayTokenDeps extends AuthDeps {
  gatewayTokenTtlDays: number;
}

interface PageQuery {
  cursor?: string;
  limit: number;
}

// Token management accepts only the JWT from login: none of these routes sets
// GATEWAY_TOKEN_ALLOWED, so a gateway token answers 401 here.
// The token value appears only in the 201 response of POST. Lists never carry it nor its hash,
// and the audit trail records only the token id and name.
export function registerGatewayTokenRoutes(app: FastifyInstance, deps: GatewayTokenDeps): void {
  app.post<{ Body: { name: string } }>(
    "/v1/me/gateway-tokens",
    {
      schema: {
        body: {
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: { name: { type: "string", minLength: 1, maxLength: 100, pattern: "\\S" } },
        },
      },
    },
    async (request, reply) => {
      const { scope } = await authenticate(request, deps);
      const { token, hash } = generateGatewayToken();
      const record = insertGatewayToken(deps.db, {
        userId: scope.userId,
        name: request.body.name,
        tokenHash: hash,
        ttlDays: deps.gatewayTokenTtlDays,
      });
      recordAuditEvent(deps.db, scope, {
        action: "gateway_token.created",
        tenantId: null,
        correlationId: request.id,
        details: { token_id: record.id, name: record.name, expires_at: record.expires_at },
      });

      return reply
        .code(201)
        .header("cache-control", "no-store")
        .send({ id: record.id, name: record.name, token, created_at: record.created_at, expires_at: record.expires_at });
    },
  );

  app.get<{ Querystring: PageQuery }>(
    "/v1/me/gateway-tokens",
    { schema: { querystring: { type: "object", properties: pageQuerySchema } } },
    async (request): Promise<Page<GatewayTokenRecord>> => {
      const { scope } = await authenticate(request, deps);
      const { cursor, limit } = request.query;
      const rows = listGatewayTokens(deps.db, scope.userId, { after: decodeTimeCursor(cursor), limit: limit + 1 });
      const page = toPage(rows, limit, (row) => `${row.created_at} ${row.id}`);
      return { items: page.rows, next_cursor: page.nextCursor };
    },
  );

  // Revoking twice answers 204 both times; the audit event is recorded once.
  app.delete<{ Params: { id: string } }>(
    "/v1/me/gateway-tokens/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", minLength: 1, maxLength: 100 } },
        },
      },
    },
    async (request, reply) => {
      const { scope } = await authenticate(request, deps);
      const result = revokeGatewayToken(deps.db, scope.userId, request.params.id);
      if (result === "not_found") throw notFound("gateway token not found");
      if (result === "revoked") {
        recordAuditEvent(deps.db, scope, {
          action: "gateway_token.revoked",
          tenantId: null,
          correlationId: request.id,
          details: { token_id: request.params.id },
        });
      }
      return reply.code(204).send();
    },
  );
}
