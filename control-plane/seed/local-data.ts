import type { Db } from "../src/db/database.ts";
import {
  upsertGatewayPermission,
  upsertMembership,
  upsertProject,
  upsertTenant,
  upsertUser,
} from "../src/db/repos/seed.ts";
import type { Role } from "../src/domain/access.ts";

// Sample data for local development: three squads, one ADMIN and two DEVs.

export const TENANTS = [
  { slug: "investimentos", name: "Investimentos" },
  { slug: "conta", name: "Conta" },
  { slug: "cartoes", name: "Cartões" },
] as const;

export type TenantSlug =(typeof TENANTS)[number]["slug"];

const PROJECTS: { tenant: TenantSlug; slug: string; name: string; description: string }[] = [
  {
    tenant: "investimentos",
    slug: "investimentos-api",
    name: "Investimentos API",
    description: "Investment orders and portfolio API.",
  },
  { tenant: "conta", slug: "conta-digital", name: "Conta Digital", description: "Digital account backend." },
  { tenant: "cartoes", slug: "cartoes-app", name: "Cartões App", description: "Card management app." },
];

const USERS: { email: string; name: string; memberships: [TenantSlug, Role][] }[] = [
  {
    email: "admin@smart-harness.local",
    name: "Admin",
    memberships: [
      ["investimentos", "ADMIN"],
      ["conta", "ADMIN"],
      ["cartoes", "ADMIN"],
    ],
  },
  {
    email: "dev@smart-harness.local",
    name: "Dev",
    memberships: [
      ["investimentos", "DEV"],
      ["conta", "DEV"],
    ],
  },
  { email: "dev.cartoes@smart-harness.local", name: "Dev Cartões", memberships: [["cartoes", "DEV"]] },
];

// Local sample permissions. Tests use fixed placeholders; seed/run.ts supplies configured service ids.
const GATEWAY_PERMISSIONS = [
  { projectSlug: "investimentos-api", server: "github", resourceType: "repo", resourceId: "acme-fake/investimentos-api" },
  { projectSlug: "investimentos-api", server: "trello", resourceType: "board", resourceId: "board-investimentos-001" },
  { projectSlug: "investimentos-api", server: "notion", resourceType: "page", resourceId: "page-investimentos-adrs" },
  { projectSlug: "investimentos-api", server: "echo", resourceType: "item", resourceId: "demo-item" },
  { projectSlug: "investimentos-api", server: "project", resourceType: "project", resourceId: "investimentos-api" },
] as const;

export interface ServiceResources {
  githubRepo?: string;
  trelloBoard?: string;
  notionPage?: string;
}

// Idempotent: every write is an upsert, all in one transaction.
export function seedLocalData(
  db: Db,
  resources: ServiceResources = {},
): { tenants: number; projects: number; users: number; gatewayPermissions: number } {
  db.transaction(() => {
    const tenantIds = new Map<string, string>();
    for (const tenant of TENANTS) {
      tenantIds.set(tenant.slug, upsertTenant(db, tenant));
    }
    for (const project of PROJECTS) {
      upsertProject(db, tenantIdOf(tenantIds, project.tenant), project);
    }
    for (const user of USERS) {
      const userId = upsertUser(db, user);
      for (const [tenant, role] of user.memberships) {
        upsertMembership(db, userId, tenantIdOf(tenantIds, tenant), role);
      }
    }
    // The local seed owns the sample project's grants for these servers. Reconfiguration revokes
    // previous sample ids rather than silently leaving old boards and pages authorized.
    const clear = db.prepare(`DELETE FROM gateway_permissions
      WHERE project_id = (SELECT id FROM projects WHERE slug = 'investimentos-api') AND server = ?`);
    for (const permission of GATEWAY_PERMISSIONS) {
      clear.run(permission.server);
      const resourceId = permission.server === "github" ? resources.githubRepo
        : permission.server === "trello" ? resources.trelloBoard
        : permission.server === "notion" ? resources.notionPage : undefined;
      upsertGatewayPermission(db, { ...permission, resourceId: resourceId ?? permission.resourceId });
    }
  }).immediate();

  return {
    tenants: TENANTS.length,
    projects: PROJECTS.length,
    users: USERS.length,
    gatewayPermissions: GATEWAY_PERMISSIONS.length,
  };
}

function tenantIdOf(tenantIds: Map<string, string>, slug: string): string {
  const id = tenantIds.get(slug);
  if (id === undefined) {
    throw new Error(`seed references unknown tenant ${slug}`);
  }
  return id;
}
