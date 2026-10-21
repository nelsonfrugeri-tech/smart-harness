import type { FastifyInstance } from "fastify";
import {
  findVisiblePlugin,
  findVisibleVersion,
  listMarketplace,
  listVisibleVersions,
} from "../../db/repos/marketplace.ts";
import { findProjectBySlug } from "../../db/repos/projects.ts";
import { COMPONENT_KINDS, PLUGIN_NAME_PATTERN, VERSION_PATTERN, type ComponentKind } from "../../domain/marketplace.ts";
import type { PackageStorage } from "../../storage/packages.ts";
import { authenticate, GATEWAY_TOKEN_ALLOWED, type AuthDeps } from "../auth.ts";
import { pluginView, versionView } from "../marketplace-views.ts";
import { decodeCursor, pageQuerySchema, toPage, type Page } from "../pagination.ts";
import { notFound } from "../problem.ts";

export interface MarketplaceDeps extends AuthDeps {
  storage: PackageStorage;
}

export const DIGEST_HEADER = "x-package-digest";

const pluginParams = {
  type: "object",
  required: ["name"],
  properties: { name: { type: "string", pattern: PLUGIN_NAME_PATTERN } },
} as const;

interface MarketplaceQuery {
  kind?: ComponentKind;
  project?: string;
  q?: string;
  cursor?: string;
  limit: number;
}

interface PageQuery {
  cursor?: string;
  limit: number;
}

// Every route authenticates. A plugin, version or project the caller cannot see answers 404,
// the same as one that does not exist.
export function registerMarketplaceRoutes(app: FastifyInstance, deps: MarketplaceDeps): void {
  app.get<{ Querystring: MarketplaceQuery }>(
    "/v1/marketplace",
    {
      config: GATEWAY_TOKEN_ALLOWED,
      schema: {
        querystring: {
          type: "object",
          properties: {
            kind: { type: "string", enum: COMPONENT_KINDS },
            project: { type: "string", minLength: 1, maxLength: 100 },
            q: { type: "string", minLength: 1, maxLength: 100 },
            ...pageQuerySchema,
          },
        },
      },
    },
    async (request): Promise<Page<ReturnType<typeof pluginView>>> => {
      const { scope } = await authenticate(request, deps);
      const { kind, project: projectSlug, q, cursor, limit } = request.query;

      // With ?project=, the list is the project's optionals: what its squad can see,
      // minus the plugins already in its baseline.
      let viewerScope = scope;
      let excludeBaselineOf: string | undefined;
      if (projectSlug !== undefined) {
        const project = findProjectBySlug(deps.db, scope, projectSlug);
        if (!project) throw notFound("project not found");
        viewerScope = { userId: scope.userId, tenantIds: [project.tenantId] };
        excludeBaselineOf = project.id;
      }

      const rows = listMarketplace(deps.db, viewerScope, {
        kind,
        q,
        excludeBaselineOf,
        afterName: decodeCursor(cursor, "string"),
        limit: limit + 1,
      });
      const page = toPage(rows, limit, (row) => row.pluginName);
      return { items: page.rows.map(pluginView), next_cursor: page.nextCursor };
    },
  );

  app.get<{ Params: { name: string } }>(
    "/v1/plugins/:name",
    { config: GATEWAY_TOKEN_ALLOWED, schema: { params: pluginParams } },
    async (request) => {
      const { scope } = await authenticate(request, deps);
      const entry = findVisiblePlugin(deps.db, scope, request.params.name);
      if (!entry) throw notFound("plugin not found");
      return pluginView(entry);
    },
  );

  app.get<{ Params: { name: string }; Querystring: PageQuery }>(
    "/v1/plugins/:name/versions",
    {
      config: GATEWAY_TOKEN_ALLOWED,
      schema: { params: pluginParams, querystring: { type: "object", properties: pageQuerySchema } },
    },
    async (request): Promise<Page<ReturnType<typeof versionView>>> => {
      const { scope } = await authenticate(request, deps);
      const { name } = request.params;
      if (!findVisiblePlugin(deps.db, scope, name)) throw notFound("plugin not found");

      const { cursor, limit } = request.query;
      const rows = listVisibleVersions(deps.db, scope, name, {
        beforeId: decodeCursor(cursor, "number"),
        limit: limit + 1,
      });
      const page = toPage(rows, limit, (row) => row.id);
      return { items: page.rows.map((row) => versionView(name, row)), next_cursor: page.nextCursor };
    },
  );

  // Streams nothing from the database: the archive comes from object storage by digest.
  app.get<{ Params: { name: string; version: string } }>(
    "/v1/plugins/:name/versions/:version/archive",
    {
      config: GATEWAY_TOKEN_ALLOWED,
      schema: {
        params: {
          type: "object",
          required: ["name", "version"],
          properties: {
            name: { type: "string", pattern: PLUGIN_NAME_PATTERN },
            version: { type: "string", pattern: VERSION_PATTERN },
          },
        },
      },
    },
    async (request, reply) => {
      const { scope } = await authenticate(request, deps);
      const { name, version } = request.params;
      const record = findVisibleVersion(deps.db, scope, name, version);
      if (!record) throw notFound("plugin version not found");

      const archive = await deps.storage.getPackage(record.digest);
      if (!archive) {
        throw new Error(`archive ${record.digest} of ${name}@${version} is missing from object storage`);
      }
      return reply
        .header("content-type", "application/gzip")
        .header("content-disposition", `attachment; filename="${name}-${version}.tar.gz"`)
        .header(DIGEST_HEADER, record.digest)
        .header("cache-control", "private, max-age=31536000, immutable")
        .send(Buffer.from(archive));
    },
  );
}
