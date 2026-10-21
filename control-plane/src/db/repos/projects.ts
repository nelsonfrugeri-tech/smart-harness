import type { Db } from "../database.ts";
import { scopeTenantIdsJson, type Scope } from "../../domain/access.ts";

export interface Project {
  id: string;
  tenantId: string;
  slug: string;
  name: string;
  description: string;
}

export interface ProjectWithTenant extends Project {
  tenant: { slug: string; name: string };
}

// Projects of the tenants in the scope, ordered by slug, at most `limit` rows.
export function listProjects(db: Db, scope: Scope, limit: number): ProjectWithTenant[] {
  const rows = db
    .prepare(
      `SELECT pr.id, pr.tenant_id AS tenantId, pr.slug, pr.name, pr.description,
              t.slug AS tenantSlug, t.name AS tenantName
         FROM projects pr
         JOIN tenants t ON t.id = pr.tenant_id
        WHERE pr.tenant_id IN (SELECT value FROM json_each(?))
        ORDER BY pr.slug
        LIMIT ?`,
    )
    .all(scopeTenantIdsJson(scope), limit) as (Project & { tenantSlug: string; tenantName: string })[];
  return rows.map(({ tenantSlug, tenantName, ...project }) => ({
    ...project,
    tenant: { slug: tenantSlug, name: tenantName },
  }));
}

// Returns undefined both when the project does not exist and when it belongs to
// a tenant outside the scope; the HTTP layer answers 404 in both cases.
export function findProjectBySlug(db: Db, scope: Scope, slug: string): ProjectWithTenant | undefined {
  const row = db
    .prepare(
      `SELECT pr.id, pr.tenant_id AS tenantId, pr.slug, pr.name, pr.description,
              t.slug AS tenantSlug, t.name AS tenantName
         FROM projects pr
         JOIN tenants t ON t.id = pr.tenant_id
        WHERE pr.slug = ?
          AND pr.tenant_id IN (SELECT value FROM json_each(?))`,
    )
    .get(slug, scopeTenantIdsJson(scope)) as (Project & { tenantSlug: string; tenantName: string }) | undefined;
  if (!row) return undefined;
  const { tenantSlug, tenantName, ...project } = row;
  return { ...project, tenant: { slug: tenantSlug, name: tenantName } };
}
