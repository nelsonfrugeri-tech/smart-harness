import type { FastifyInstance } from "fastify";
import { recordAuditEvent } from "../../db/repos/audit.ts";
import { findRepository, listRepositories, registerRepository, type RepositoryRecord } from "../../db/repos/repositories.ts";
import { isAdminOf } from "../../domain/access.ts";
import type { Visibility } from "../../domain/marketplace.ts";
import { RELEASE_TAG_PATTERN, repositoryUrl, syncRepository, type GitHubPackages, type PackageInspector } from "../../domain/repositories.ts";
import { authenticate, type AuthDeps } from "../auth.ts";
import { decodeCursor, pageQuerySchema, toPage } from "../pagination.ts";
import { forbidden, notFound } from "../problem.ts";

interface RepositoryDeps extends AuthDeps { github: GitHubPackages; inspectPackage: PackageInspector }
const params = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1, maxLength: 100 } } } as const;

export function registerRepositoryRoutes(app: FastifyInstance, deps: RepositoryDeps): void {
  app.get<{ Querystring: { cursor?: string; limit: number } }>("/v1/repositories", {
    schema: { querystring: { type: "object", properties: pageQuerySchema } },
  }, async (request) => {
    const { scope } = await authenticate(request, deps);
    const { cursor, limit } = request.query;
    const rows = listRepositories(deps.db, scope, { afterId: decodeCursor(cursor, "string"), limit: limit + 1 });
    const page = toPage(rows, limit, (row) => row.id);
    return { items: page.rows.map(repositoryView), next_cursor: page.nextCursor };
  });

  app.post<{ Body: { owner: string; repo: string; tenant_id: string; visibility: Visibility } }>("/v1/repositories", {
    schema: { body: { type: "object", additionalProperties: false, required: ["owner", "repo", "tenant_id", "visibility"], properties: {
      owner: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9-]{0,38}$" },
      repo: { type: "string", pattern: "^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$" },
      tenant_id: { type: "string", minLength: 1, maxLength: 100 },
      visibility: { type: "string", enum: ["squad", "organization"] },
    } } },
  }, async (request, reply) => {
    const principal = await authenticate(request, deps);
    const body = request.body;
    const result = registerRepository(deps.db, principal, { owner: body.owner, repo: body.repo, tenantId: body.tenant_id, visibility: body.visibility });
    if (result.created) recordAuditEvent(deps.db, principal.scope, {
      action: "repository.registered", tenantId: body.tenant_id, correlationId: request.id,
      details: { repository_id: result.repository.id, repository_url: repositoryUrl(result.repository) },
    });
    return reply.code(result.created ? 201 : 200).send(repositoryView(result.repository));
  });

  app.post<{ Params: { id: string }; Body: { tag: string } }>("/v1/repositories/:id/sync", {
    schema: { params, body: { type: "object", additionalProperties: false, required: ["tag"], properties: {
      tag: { type: "string", pattern: RELEASE_TAG_PATTERN, maxLength: 100 },
    } } },
  }, async (request) => {
    const principal = await authenticate(request, deps);
    const repository = findRepository(deps.db, principal.scope, request.params.id);
    if (!repository) throw notFound("repository not found");
    if (!isAdminOf(principal, repository.tenantId)) throw forbidden("forbidden", "only a squad ADMIN can synchronize repositories");
    const result = await syncRepository(deps, principal, repository, request.body.tag);
    recordAuditEvent(deps.db, principal.scope, {
      action: "repository.synced", tenantId: repository.tenantId, correlationId: request.id,
      details: { repository_id: repository.id, ...result },
    });
    return result;
  });
}

function repositoryView(row: RepositoryRecord) {
  const url = repositoryUrl(row);
  return {
    id: row.id, owner: row.owner, repo: row.repo, repository_url: url,
    tenant: { id: row.tenantId, slug: row.tenantSlug, name: row.tenantName },
    visibility: row.visibility, created_at: row.createdAt, last_synced_at: row.lastSyncedAt,
    last_sync: row.lastPlugin === null || row.lastVersion === null || row.lastTag === null || row.lastCommitSha === null || row.lastDigest === null ? null : {
      plugin: row.lastPlugin, version: row.lastVersion, tag: row.lastTag,
      commit_sha: row.lastCommitSha, digest: row.lastDigest,
      release_url: `${url}/releases/tag/${encodeURIComponent(row.lastTag)}`,
    },
  };
}
