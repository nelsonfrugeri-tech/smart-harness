import type { FastifyInstance } from "fastify";
import { listBaselines, listMarketplace, type BaselineEntry } from "../../db/repos/marketplace.ts";
import { findProjectBySlug, listProjects } from "../../db/repos/projects.ts";
import { COMPONENT_KINDS, type ComponentKind } from "../../domain/marketplace.ts";
import { authenticate, type AuthDeps } from "../auth.ts";
import { pluginView } from "../marketplace-views.ts";
import { DEFAULT_LIMIT, toPage } from "../pagination.ts";
import { notFound } from "../problem.ts";

export interface ProjectRoutesDeps extends AuthDeps {
  gatewayPublicUrl: string;
}

// The workspace lists at most this many projects; squads have a handful each.
const MAX_WORKSPACE_PROJECTS = 100;

export function registerProjectRoutes(app: FastifyInstance, deps: ProjectRoutesDeps): void {
  // The caller's projects, each with its baseline and the component counts of that baseline.
  // Three queries in total, whatever the number of projects.
  app.get("/v1/workspace", async (request) => {
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
}

function countComponents(baseline: BaselineEntry[]): Record<ComponentKind, number> {
  const counts = Object.fromEntries(COMPONENT_KINDS.map((kind) => [kind, 0])) as Record<ComponentKind, number>;
  for (const entry of baseline) {
    for (const component of entry.components) counts[component.kind] += 1;
  }
  return counts;
}
