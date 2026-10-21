import { randomUUID } from "node:crypto";
import type { Db } from "../database.ts";
import { scopeTenantIdsJson, type Scope } from "../../domain/access.ts";
import {
  PublishError,
  type Component,
  type ComponentKind,
  type PluginType,
  type PackageManifest,
  type Visibility,
} from "../../domain/marketplace.ts";

// Visibility rule, applied by every read below: a version is visible when its plugin belongs
// to a tenant in the scope, or when it is "organization" and the caller has at least one
// membership. A user without memberships sees nothing.
const VISIBLE = `(p.tenant_id IN (SELECT value FROM json_each(@scope))
   OR (v.visibility = 'organization' AND json_array_length(@scope) > 0))`;

const PACKAGE_TYPE = `CASE
  WHEN EXISTS (SELECT 1 FROM components c WHERE c.version_id = v.id)
   AND NOT EXISTS (SELECT 1 FROM components c WHERE c.version_id = v.id AND c.kind <> 'mcp') THEN 'connector'
  WHEN EXISTS (SELECT 1 FROM components c WHERE c.version_id = v.id)
   AND NOT EXISTS (SELECT 1 FROM components c WHERE c.version_id = v.id AND c.kind <> 'skill') THEN 'skill'
  ELSE 'agent' END`;

const VERSION_COLUMNS = `v.id, v.version, v.visibility, v.description, v.digest,
  v.keywords, v.size_bytes AS sizeBytes, v.published_at AS publishedAt`;

export interface TenantRef {
  slug: string;
  name: string;
}

export interface VersionRecord {
  id: number;
  version: string;
  visibility: Visibility;
  description: string;
  digest: string;
  sizeBytes: number;
  publishedAt: string;
  keywords: string;
}

// A plugin with its latest visible version and that version's components.
export interface PluginEntry {
  pluginName: string;
  tenant: TenantRef;
  version: VersionRecord;
  components: Component[];
}

export interface MarketplaceFilter {
  kind?: ComponentKind;
  type?: PluginType;
  q?: string;
  name?: string;
  // Keyset pagination: only plugins whose name sorts after this one.
  afterName?: string;
  // Leaves out the plugins pinned in this project's baseline (the project's optionals).
  excludeBaselineOf?: string;
  limit: number;
}

interface EntryRow extends VersionRecord {
  pluginName: string;
  tenantSlug: string;
  tenantName: string;
}

// Plugins ordered by name, each with its latest visible version. Two queries per call:
// the page, then the components of every version in the page.
export function listMarketplace(db: Db, scope: Scope, filter: MarketplaceFilter): PluginEntry[] {
  const rows = db
    .prepare(
      `WITH latest AS (
         SELECT v.plugin_id, max(v.id) AS version_id
           FROM plugin_versions v
           JOIN plugins p ON p.id = v.plugin_id
          WHERE ${VISIBLE}
          GROUP BY v.plugin_id
       )
       SELECT p.name AS pluginName, t.slug AS tenantSlug, t.name AS tenantName, ${VERSION_COLUMNS}
         FROM latest l
         JOIN plugin_versions v ON v.id = l.version_id
         JOIN plugins p ON p.id = l.plugin_id
         JOIN tenants t ON t.id = p.tenant_id
        WHERE (@name IS NULL OR p.name = @name)
          AND (@after IS NULL OR p.name > @after)
          AND (@kind IS NULL OR EXISTS (
                SELECT 1 FROM components c WHERE c.version_id = v.id AND c.kind = @kind))
          AND (@type IS NULL OR (${PACKAGE_TYPE}) = @type)
          AND (@pattern IS NULL
                OR p.name LIKE @pattern ESCAPE '\\'
                OR v.description LIKE @pattern ESCAPE '\\'
                OR EXISTS (SELECT 1 FROM json_each(v.keywords) k WHERE k.value LIKE @pattern ESCAPE '\\')
                OR EXISTS (SELECT 1 FROM components c
                            WHERE c.version_id = v.id
                              AND (c.name LIKE @pattern ESCAPE '\\' OR c.description LIKE @pattern ESCAPE '\\')))
          AND (@excluded IS NULL OR NOT EXISTS (
                SELECT 1 FROM project_baseline b WHERE b.project_id = @excluded AND b.plugin_id = p.id))
        ORDER BY p.name
        LIMIT @limit`,
    )
    .all({
      scope: scopeTenantIdsJson(scope),
      name: filter.name ?? null,
      after: filter.afterName ?? null,
      kind: filter.kind ?? null,
      type: filter.type ?? null,
      pattern: filter.q === undefined ? null : `%${escapeLike(filter.q)}%`,
      excluded: filter.excludeBaselineOf ?? null,
      limit: filter.limit,
    }) as EntryRow[];

  return withComponents(db, rows);
}

// Latest visible version of one plugin; undefined when missing or not visible.
export function findVisiblePlugin(db: Db, scope: Scope, name: string): PluginEntry | undefined {
  return listMarketplace(db, scope, { name, limit: 1 })[0];
}

// Visible versions of one plugin, newest first. Keyset pagination on the version id.
export function listVisibleVersions(
  db: Db,
  scope: Scope,
  pluginName: string,
  page: { beforeId?: number; limit: number },
): VersionRecord[] {
  return db
    .prepare(
      `SELECT ${VERSION_COLUMNS}
         FROM plugin_versions v
         JOIN plugins p ON p.id = v.plugin_id
        WHERE p.name = @name
          AND ${VISIBLE}
          AND (@before IS NULL OR v.id < @before)
        ORDER BY v.id DESC
        LIMIT @limit`,
    )
    .all({
      scope: scopeTenantIdsJson(scope),
      name: pluginName,
      before: page.beforeId ?? null,
      limit: page.limit,
    }) as VersionRecord[];
}

export function findVisibleVersion(
  db: Db,
  scope: Scope,
  pluginName: string,
  version: string,
): VersionRecord | undefined {
  return db
    .prepare(
      `SELECT ${VERSION_COLUMNS}
         FROM plugin_versions v
         JOIN plugins p ON p.id = v.plugin_id
        WHERE p.name = @name AND v.version = @version AND ${VISIBLE}`,
    )
    .get({ scope: scopeTenantIdsJson(scope), name: pluginName, version }) as VersionRecord | undefined;
}

export interface BaselineEntry extends PluginEntry {
  projectId: string;
}

// Baseline of the given projects, limited to projects in the scope. A pinned version is
// listed only while it is visible to the project's own squad.
export function listBaselines(db: Db, scope: Scope, projectIds: readonly string[]): BaselineEntry[] {
  const rows = db
    .prepare(
      `SELECT b.project_id AS projectId, p.name AS pluginName,
              t.slug AS tenantSlug, t.name AS tenantName, ${VERSION_COLUMNS}
         FROM project_baseline b
         JOIN projects pr ON pr.id = b.project_id
         JOIN plugins p ON p.id = b.plugin_id
         JOIN plugin_versions v ON v.id = b.version_id
         JOIN tenants t ON t.id = p.tenant_id
        WHERE b.project_id IN (SELECT value FROM json_each(@projects))
          AND pr.tenant_id IN (SELECT value FROM json_each(@scope))
          AND (p.tenant_id = pr.tenant_id OR v.visibility = 'organization')
        ORDER BY b.project_id, p.name`,
    )
    .all({ scope: scopeTenantIdsJson(scope), projects: JSON.stringify(projectIds) }) as (EntryRow & {
    projectId: string;
  })[];

  const entries = withComponents(db, rows);
  return entries.map((entry, index) => ({ ...entry, projectId: rows[index].projectId }));
}

export interface NewVersion {
  tenantId: string;
  visibility: Visibility;
  manifest: PackageManifest;
  digest: string;
  sizeBytes: number;
}

// Records a published version in one synchronous transaction. Publishing the same version
// with the same digest again changes nothing; with another digest it fails, because versions
// are immutable. The tenant must be in the publisher's scope.
export function savePublishedVersion(
  db: Db,
  scope: Scope,
  input: NewVersion,
): { status: "created" | "unchanged"; versionId: number } {
  const tenantIds = JSON.parse(scopeTenantIdsJson(scope)) as string[];
  if (!tenantIds.includes(input.tenantId)) {
    throw new PublishError("forbidden", `tenant ${input.tenantId} is outside the publisher's scope`);
  }
  return db.transaction(() => insertPublishedVersion(db, scope.userId, input)).immediate();
}

// The writes of a publication: the plugin when it is new, the version and its components.
// It opens no transaction of its own, so the caller decides the boundary: savePublishedVersion
// wraps it alone, the approval wraps it together with the contribution update and the audit.
// Throws PublishError plugin_owned_by_other_squad or version_exists before writing anything.
export function insertPublishedVersion(
  db: Db,
  publishedBy: string,
  input: NewVersion,
): { status: "created" | "unchanged"; versionId: number } {
  const { manifest } = input;
  const plugin = db.prepare("SELECT id, tenant_id AS tenantId FROM plugins WHERE name = ?").get(manifest.name) as
    | { id: string; tenantId: string }
    | undefined;
  if (plugin && plugin.tenantId !== input.tenantId) {
    throw new PublishError("plugin_owned_by_other_squad", `plugin ${manifest.name} belongs to another squad`);
  }
  const pluginId = plugin?.id ?? randomUUID();
  if (!plugin) {
    db.prepare("INSERT INTO plugins (id, tenant_id, name) VALUES (?, ?, ?)").run(pluginId, input.tenantId, manifest.name);
  }

  const existing = db
    .prepare("SELECT id, digest FROM plugin_versions WHERE plugin_id = ? AND version = ?")
    .get(pluginId, manifest.version) as { id: number; digest: string } | undefined;
  if (existing) {
    if (existing.digest !== input.digest) {
      throw new PublishError(
        "version_exists",
        `${manifest.name}@${manifest.version} is already published with digest ${existing.digest}`,
      );
    }
    return { status: "unchanged", versionId: existing.id };
  }

  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO plugin_versions (plugin_id, version, visibility, description, keywords, digest, size_bytes, published_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      pluginId,
      manifest.version,
      input.visibility,
      manifest.description,
      JSON.stringify(manifest.keywords ?? []),
      input.digest,
      input.sizeBytes,
      publishedBy,
    );
  const versionId = Number(lastInsertRowid);
  const insertComponent = db.prepare("INSERT INTO components (version_id, kind, name, description) VALUES (?, ?, ?, ?)");
  for (const component of manifest.components) {
    insertComponent.run(versionId, component.kind, component.name, component.description);
  }
  return { status: "created", versionId };
}

// Pins a version in the project's baseline. Returns false when the project is outside the
// scope or the version is not visible to the project's squad.
export function pinBaselineVersion(
  db: Db,
  scope: Scope,
  pin: { projectSlug: string; pluginName: string; version: string },
): boolean {
  const target = db
    .prepare(
      `SELECT pr.id AS projectId, p.id AS pluginId, v.id AS versionId
         FROM projects pr
         JOIN plugins p ON p.name = @plugin
         JOIN plugin_versions v ON v.plugin_id = p.id AND v.version = @version
        WHERE pr.slug = @project
          AND pr.tenant_id IN (SELECT value FROM json_each(@scope))
          AND (p.tenant_id = pr.tenant_id OR v.visibility = 'organization')`,
    )
    .get({
      scope: scopeTenantIdsJson(scope),
      project: pin.projectSlug,
      plugin: pin.pluginName,
      version: pin.version,
    }) as { projectId: string; pluginId: string; versionId: number } | undefined;
  if (!target) return false;

  db.prepare(
    `INSERT INTO project_baseline (project_id, plugin_id, version_id) VALUES (?, ?, ?)
     ON CONFLICT (project_id, plugin_id) DO UPDATE
       SET version_id = excluded.version_id,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE version_id <> excluded.version_id`,
  ).run(target.projectId, target.pluginId, target.versionId);
  return true;
}

function withComponents(db: Db, rows: EntryRow[]): PluginEntry[] {
  const componentsByVersion = new Map<number, Component[]>();
  if (rows.length > 0) {
    const components = db
      .prepare(
        `SELECT version_id AS versionId, kind, name, description
           FROM components
          WHERE version_id IN (SELECT value FROM json_each(?))
          ORDER BY kind, name`,
      )
      .all(JSON.stringify([...new Set(rows.map((row) => row.id))])) as (Component & { versionId: number })[];
    for (const { versionId, ...component } of components) {
      const list = componentsByVersion.get(versionId) ?? [];
      list.push(component);
      componentsByVersion.set(versionId, list);
    }
  }

  return rows.map((row) => ({
    pluginName: row.pluginName,
    tenant: { slug: row.tenantSlug, name: row.tenantName },
    version: {
      id: row.id,
      version: row.version,
      visibility: row.visibility,
      description: row.description,
      digest: row.digest,
      sizeBytes: row.sizeBytes,
      publishedAt: row.publishedAt,
      keywords: row.keywords,
    },
    components: componentsByVersion.get(row.id) ?? [],
  }));
}

// LIKE treats % and _ as wildcards; the search is a plain substring.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
