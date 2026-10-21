import type { Db } from "./database.ts";

// Read-only queries that decide who may call what. Roles are not used here: any membership
// in the project's tenant gives access, as in the API.

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

// Same rule as the API: control-plane/src/db/repos/gateway-tokens.ts (ACTIVE_GATEWAY_TOKEN_SQL).
// A test compares both texts, so they cannot drift apart silently.
export const ACTIVE_GATEWAY_TOKEN_SQL = `SELECT user_id FROM gateway_tokens
  WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ${NOW}`;

export function findActiveTokenUserId(db: Db, tokenHash: string): string | undefined {
  const row = db.prepare(ACTIVE_GATEWAY_TOKEN_SQL).get(tokenHash) as { user_id: string } | undefined;
  return row?.user_id;
}

export interface ProjectRef {
  id: string;
  slug: string;
  tenantId: string;
}

// Undefined both when the project does not exist and when it belongs to a tenant the user is not in.
export function findProjectForUser(db: Db, userId: string, slug: string): ProjectRef | undefined {
  return db
    .prepare(
      `SELECT p.id, p.slug, p.tenant_id AS tenantId
         FROM projects p
         JOIN memberships m ON m.tenant_id = p.tenant_id AND m.user_id = ?
        WHERE p.slug = ?`,
    )
    .get(userId, slug) as ProjectRef | undefined;
}

// The resources the project may use on one server, grouped by resource type.
export function listAllowedResources(db: Db, projectId: string, server: string): Record<string, string[]> {
  const rows = db
    .prepare(
      `SELECT resource_type AS type, resource_id AS id
         FROM gateway_permissions
        WHERE project_id = ? AND server = ?
        ORDER BY resource_type, resource_id`,
    )
    .all(projectId, server) as { type: string; id: string }[];
  const byType: Record<string, string[]> = {};
  for (const { type, id } of rows) {
    (byType[type] ??= []).push(id);
  }
  return byType;
}
