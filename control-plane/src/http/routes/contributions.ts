import type { FastifyInstance } from "fastify";
import { findContribution, listContributions } from "../../db/repos/contributions.ts";
import { isAdminOf } from "../../domain/access.ts";
import { ApprovalError, approveContribution, type ApprovalErrorCode } from "../../domain/contributions.ts";
import { authenticate, type AuthDeps } from "../auth.ts";
import { contributionView } from "../contribution-views.ts";
import { decodeTimeCursor, pageQuerySchema, timeCursorKey, toPage } from "../pagination.ts";
import { HttpProblem, notFound } from "../problem.ts";

const contributionParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", minLength: 1, maxLength: 100 } },
} as const;

const APPROVAL_STATUS: Record<ApprovalErrorCode, number> = {
  not_found: 404,
  forbidden: 403,
  self_approval: 403,
  contribution_not_submitted: 409,
  digest_mismatch: 409,
  version_exists: 409,
  plugin_owned_by_other_squad: 409,
};

interface ListQuery {
  view: "mine" | "review";
  cursor?: string;
  limit: number;
}

// A contribution is visible to its author and to the ADMINs of its squad; anyone else gets 404.
// ?view=review is the queue of submitted contributions, by other authors, in the squads where the
// caller is ADMIN. Every route accepts only the login JWT.
export function registerContributionRoutes(app: FastifyInstance, deps: AuthDeps): void {
  app.get<{ Querystring: ListQuery }>(
    "/v1/contributions",
    {
      schema: {
        querystring: {
          type: "object",
          properties: { view: { type: "string", enum: ["mine", "review"], default: "mine" }, ...pageQuerySchema },
        },
      },
    },
    async (request) => {
      const principal = await authenticate(request, deps);
      const { view, cursor, limit } = request.query;
      const adminTenantIds = principal.memberships
        .filter((membership) => membership.role === "ADMIN")
        .map((membership) => membership.tenant.id);
      const rows = listContributions(
        deps.db,
        principal.scope,
        view === "review" ? { kind: "review", tenantIds: adminTenantIds } : { kind: "mine" },
        { after: decodeTimeCursor(cursor), limit: limit + 1 },
      );
      const page = toPage(rows, limit, timeCursorKey);
      return { items: page.rows.map(contributionView), next_cursor: page.nextCursor };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/contributions/:id",
    { schema: { params: contributionParams } },
    async (request) => {
      const principal = await authenticate(request, deps);
      const contribution = findContribution(deps.db, principal.scope, request.params.id);
      if (
        !contribution ||
        (contribution.author.id !== principal.user.id && !isAdminOf(principal, contribution.tenantId))
      ) {
        throw notFound("contribution not found");
      }
      return contributionView(contribution);
    },
  );

  // Publishes the contribution if `digest` is the one submitted. The whole approval is one
  // database transaction (domain/contributions.ts); a failure leaves nothing published.
  app.post<{ Params: { id: string }; Body: { digest: string; comment?: string } }>(
    "/v1/contributions/:id/approve",
    {
      schema: {
        params: contributionParams,
        body: {
          type: "object",
          required: ["digest"],
          additionalProperties: false,
          properties: {
            digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
            comment: { type: "string", maxLength: 2000 },
          },
        },
      },
    },
    async (request) => {
      const principal = await authenticate(request, deps);
      try {
        const published = approveContribution(deps.db, principal, {
          contributionId: request.params.id,
          digest: request.body.digest,
          comment: request.body.comment ?? null,
          correlationId: request.id,
        });
        return contributionView(published);
      } catch (error) {
        if (error instanceof ApprovalError) {
          throw new HttpProblem(APPROVAL_STATUS[error.code], error.code, error.message);
        }
        throw error;
      }
    },
  );
}
