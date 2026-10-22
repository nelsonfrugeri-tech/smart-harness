import type { Db } from "../database.ts";
import type { Membership, Role, User } from "../../domain/access.ts";

// Resolves the caller's identity. These lookups are what build the scope,
// so they are filtered by the user's own id or email instead of by a scope.

export function findUserByEmail(db: Db, email: string): User | undefined {
  return db.prepare("SELECT id, email, name, job_title FROM users WHERE email = ?").get(email) as
    | User
    | undefined;
}

export function findUserById(db: Db, userId: string): User | undefined {
  return db.prepare("SELECT id, email, name, job_title FROM users WHERE id = ?").get(userId) as
    | User
    | undefined;
}

interface MembershipRow {
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
  role: Role;
}

// One query for all memberships; the list is bounded by the number of tenants.
export function listMembershipsOfUser(db: Db, userId: string): Membership[] {
  const rows = db
    .prepare(
      `SELECT t.id AS tenant_id, t.slug AS tenant_slug, t.name AS tenant_name, m.role
         FROM memberships m
         JOIN tenants t ON t.id = m.tenant_id
        WHERE m.user_id = ?
        ORDER BY t.slug`,
    )
    .all(userId) as MembershipRow[];

  return rows.map((row) => ({
    tenant: { id: row.tenant_id, slug: row.tenant_slug, name: row.tenant_name },
    role: row.role,
  }));
}
