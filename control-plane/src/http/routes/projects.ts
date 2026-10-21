import type { FastifyInstance } from "fastify";
import { recordAuditEvent } from "../../db/repos/audit.ts";
import { listBaselines, listMarketplace, pinBaselineVersion, type BaselineEntry } from "../../db/repos/marketplace.ts";
import { findProjectBySlug, listProjects } from "../../db/repos/projects.ts";
import { isAdminOf } from "../../domain/access.ts";
import {
  COMPONENT_KINDS,
  PLUGIN_NAME_PATTERN,
  VERSION_PATTERN,
  type ComponentKind,
} from "../../domain/marketplace.ts";
import { authenticate, GATEWAY_TOKEN_ALLOWED, type AuthDeps } from "../auth.ts";
import { pluginView } from "../marketplace-views.ts";
import { DEFAULT_LIMIT, toPage } from "../pagination.ts";
import { forbidden, notFound } from "../problem.ts";

export interface ProjectRoutesDeps extends AuthDeps {
  gatewayPublicUrl: string;
}

// The workspace lists at most this many projects; squads have a handful each.
const MAX_WORKSPACE_PROJECTS = 100;

export function registerProjectRoutes(app: FastifyInstance, deps: ProjectRoutesDeps): void {
  // The caller's projects, each with its baseline and the component counts of that baseline.
  // Three queries in total, whatever the number of projects.
  app.get("/v1/workspace", { config: GATEWAY_TOKEN_ALLOWED }, async (request) => {
    const { user, scope } = await authenticate(request, deps);
    const projects = listProjects(deps.db, scope, MAX_WORKSPACE_PROJECTS);
    const baselines = listBaselines(
      deps.db,
      scope,
      projects.map((project) => project.id),
    );

    return {
      user,
      projects: projects.map((project) => {
        const baseline = baselines.filter((entry) => entry.projectId === project.id);
        return {
          slug: project.slug,
          name: project.name,
          description: project.description,
          tenant: project.tenant,
          counts: countComponents(baseline),
          baseline: baseline.map((entry) => ({ plugin: entry.pluginName, version: entry.version.version })),
        };
      }),
    };
  });

  // What `harness setup <slug>` installs: the baseline, the first page of optionals and the
  // gateway URL. It never carries a token or any other secret: the developer configures the
  // gateway token separately.
  app.get<{ Params: { slug: string } }>(
    "/v1/projects/:slug/setup-plan",
    {
      config: GATEWAY_TOKEN_ALLOWED,
      schema: {
        params: {
          type: "object",
          required: ["slug"],
          properties: { slug: { type: "string", minLength: 1, maxLength: 100 } },
        },
      },
    },
    async (request) => {
      const { scope } = await authenticate(request, deps);
      const project = findProjectBySlug(deps.db, scope, request.params.slug);
      if (!project) throw notFound("project not found");

      // Visibility is the project's squad view, even when the caller belongs to more squads.
      const projectScope = { userId: scope.userId, tenantIds: [project.tenantId] };
      const baseline = listBaselines(deps.db, projectScope, [project.id]);
      const optional = toPage(
        listMarketplace(deps.db, projectScope, { excludeBaselineOf: project.id, limit: DEFAULT_LIMIT + 1 }),
        DEFAULT_LIMIT,
        (row) => row.pluginName,
      );

      return {
        project: {
          slug: project.slug,
          name: project.name,
          description: project.description,
          tenant: project.tenant,
        },
        gateway: { url: deps.gatewayPublicUrl },
        baseline: baseline.map(pluginView),
        // Continue with GET /v1/marketplace?project=<slug>&cursor=<next_cursor>.
        optional: { items: optional.rows.map(pluginView), next_cursor: optional.nextCursor },
      };
    },
  );

  // Pins one plugin version in the project's baseline. Rollback is pinning an older version;
  // the next setup-plan carries it and `harness sync` installs it. ADMIN of the project's squad
  // only, with the login JWT. The pin and its audit event are one transaction.
  app.put<{ Params: { slug: string; plugin: string }; Body: { version: string } }>(
    "/v1/projects/:slug/baseline/:plugin",
    {
      schema: {
        params: {
          type: "object",
          required: ["slug", "plugin"],
          properties: {
            slug: { type: "string", minLength: 1, maxLength: 100 },
            plugin: { type: "string", pattern: PLUGIN_NAME_PATTERN },
          },
        },
        body: {
          type: "object",
          required: ["version"],
          additionalProperties: false,
          properties: { version: { type: "string", pattern: VERSION_PATTERN } },
        },
      },
    },
    async (request) => {
      const principal = await authenticate(request, deps);
      const { slug, plugin } = request.params;
      const { version } = request.body;
      const project = findProjectBySlug(deps.db, principal.scope, slug);
      if (!project) throw notFound("project not found");
      if (!isAdminOf(principal, project.tenantId)) {
        throw forbidden("forbidden", "only an ADMIN of the project's squad changes its baseline");
      }

      const pinned = deps.db
        .transaction(() => {
          if (!pinBaselineVersion(deps.db, principal.scope, { projectSlug: slug, pluginName: plugin, version })) {
            return false;
          }
          recordAuditEvent(deps.db, principal.scope, {
            action: "baseline.pinned",
            tenantId: project.tenantId,
            correlationId: request.id,
            details: { project: slug, plugin, version },
          });
          return true;
        })
        .immediate();
      if (!pinned) throw notFound("plugin version not found");
      return { plugin, version };
    },
  );
}

function countComponents(baseline: BaselineEntry[]): Record<ComponentKind, number> {
  const counts = Object.fromEntries(COMPONENT_KINDS.map((kind) => [kind, 0])) as Record<ComponentKind, number>;
  for (const entry of baseline) {
    for (const component of entry.components) counts[component.kind] += 1;
  }
  return counts;
}
