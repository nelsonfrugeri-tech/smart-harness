import type { FastifyInstance } from "fastify";
import { listMarketplace } from "../../db/repos/marketplace.ts";
import { COMPONENT_KINDS, PLUGIN_TYPES, type ComponentKind, type PluginType } from "../../domain/marketplace.ts";
import { pluginView } from "../marketplace-views.ts";
import { decodeCursor, pageQuerySchema, toPage } from "../pagination.ts";
import { authenticate, GATEWAY_TOKEN_ALLOWED, type AuthDeps } from "../auth.ts";

// Returns the caller and their memberships as stored right now.
// A user without memberships gets an empty list and sees no tenant data.
export function registerMeRoute(app: FastifyInstance, deps: AuthDeps & { gatewayPublicUrl: string }): void {
  app.get("/v1/me", { config: GATEWAY_TOKEN_ALLOWED }, async (request) => {
    const { user, memberships } = await authenticate(request, deps);
    return { user, memberships };
  });

  app.get<{ Querystring: { cursor?: string; limit: number; kind?: ComponentKind; type?: PluginType; q?: string } }>(
    "/v1/me/setup-plan",
    {
      config: GATEWAY_TOKEN_ALLOWED,
      schema: { querystring: { type: "object", additionalProperties: false, properties: {
        ...pageQuerySchema,
        kind: { type: "string", enum: COMPONENT_KINDS },
        type: { type: "string", enum: PLUGIN_TYPES },
        q: { type: "string", minLength: 1, maxLength: 100 },
      } } },
    },
    async (request) => {
      const { scope } = await authenticate(request, deps);
      const { cursor, limit, kind, type, q } = request.query;
      const page = toPage(listMarketplace(deps.db, scope, {
        afterName: decodeCursor(cursor, "string"), limit: limit + 1, kind, type, q,
      }), limit, (row) => row.pluginName);
      return { gateway: { url: deps.gatewayPublicUrl }, optional: {
        items: page.rows.map(pluginView), next_cursor: page.nextCursor,
      } };
    },
  );
}
