import { randomUUID } from "node:crypto";
import type { Db } from "../database.ts";
import type { Role } from "../../domain/access.ts";

// System writes used only by the local seed (seed/). They are not scoped because
// no user is acting; the seed refuses to run outside APP_ENV=local.
// Each upsert is keyed by a natural key, so running the seed again changes nothing.

export function upsertTenant(db: Db, tenant: { slug: string; name: string }): string {
  const row = db
    .prepare(
      `INSERT INTO tenants (id, slug, name) VALUES (?, ?, ?)
       ON CONFLICT (slug) DO UPDATE SET name = excluded.name
       RETURNING id`,
    )
    .get(randomUUID(), tenant.slug, tenant.name) as { id: string };
  return row.id;
}

export function upsertUser(db: Db, user: { email: string; name: string }): string {
  const row = db
    .prepare(
      `INSERT INTO users (id, email, name) VALUES (?, ?, ?)
       ON CONFLICT (email) DO UPDATE SET name = excluded.name
       RETURNING id`,
    )
    .get(randomUUID(), user.email, user.name) as { id: string };
  return row.id;
}

export function upsertMembership(db: Db, userId: string, tenantId: string, role: Role): void {
  db.prepare(
    `INSERT INTO memberships (user_id, tenant_id, role) VALUES (?, ?, ?)
     ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = excluded.role`,
  ).run(userId, tenantId, role);
}

export function tenantIdBySlug(db: Db, slug: string): string {
  const row = db.prepare("SELECT id FROM tenants WHERE slug = ?").get(slug) as { id: string } | undefined;
  if (!row) {
    throw new Error(`tenant ${slug} not found; run npm run seed first`);
  }
  return row.id;
}

export function upsertProject(
  db: Db,
  tenantId: string,
  project: { slug: string; name: string; description: string },
): void {
  db.prepare(
    `INSERT INTO projects (id, tenant_id, slug, name, description) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (slug) DO UPDATE SET name = excluded.name, description = excluded.description`,
  ).run(randomUUID(), tenantId, project.slug, project.name, project.description);
}
