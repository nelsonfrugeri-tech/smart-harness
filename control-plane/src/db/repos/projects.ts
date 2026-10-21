import type { Db } from "../database.ts";
import { scopeTenantIdsJson, type Scope } from "../../domain/access.ts";

export interface Project {
  id: string;
  tenantId: string;
  slug: string;
  name: string;
  description: string;
}

// Returns undefined both when the project does not exist and when it belongs to
// a tenant outside the scope; the HTTP layer answers 404 in both cases.
export function findProjectBySlug(db: Db, scope: Scope, slug: string): Project | undefined {
  return db
    .prepare(
      `SELECT id, tenant_id AS tenantId, slug, name, description
         FROM projects
        WHERE slug = ?
          AND tenant_id IN (SELECT value FROM json_each(?))`,
    )
    .get(slug, scopeTenantIdsJson(scope)) as Project | undefined;
}
