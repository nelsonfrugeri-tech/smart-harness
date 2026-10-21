import type { Db } from "../src/db/database.ts";
import {
  deleteGatewayPermissions,
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

// Example permissions of investimentos-api. The identifiers are fictitious; see GatewayResources for the real ones.
// The echo server only exists with APP_ENV=local and is a harmless target for tests and demos.
const GATEWAY_PERMISSIONS = [
  { projectSlug: "investimentos-api", server: "github", resourceType: "repo", resourceId: "acme-fake/investimentos-api" },
  { projectSlug: "investimentos-api", server: "trello", resourceType: "board", resourceId: "board-investimentos-001" },
  { projectSlug: "investimentos-api", server: "notion", resourceType: "page", resourceId: "page-investimentos-adrs" },
  { projectSlug: "investimentos-api", server: "echo", resourceType: "item", resourceId: "demo-item" },
] as const;

// The real resources of investimentos-api, from the environment (see .env.example). A server whose
// variable is empty keeps the fictitious example above. A server with values has its rows replaced,
// so the example is removed and the permission list always matches the environment.
export interface GatewayResources {
  github?: string[];
  trello?: string[];
  notion?: string[];
}

interface Permission {
  projectSlug: string;
  server: string;
  resourceType: string;
  resourceId: string;
}

const RESOURCE_TYPES ={ github: "repo", trello: "board", notion: "page" } as const;
const REFERENCE_PROJECT = "investimentos-api";

export function gatewayResourcesFromEnv(env: NodeJS.ProcessEnv = process.env): GatewayResources {
  const resources: GatewayResources = {};
  const repos = commaList(env.GITHUB_REPOS).map((repo) => checked("GITHUB_REPOS", repo, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).toLowerCase());
  if (repos.length > 0) resources.github = repos;
  const boards = commaList(env.TRELLO_BOARD_ID).map((board) => checked("TRELLO_BOARD_ID", board, /^[A-Za-z0-9]{1,64}$/));
  if (boards.length > 0) resources.trello = boards;
  // Notion page ids are stored as 32 lowercase hex characters, the form the gateway compares.
  const pages = commaList(env.NOTION_PAGE_IDS).map((page) =>
    checked("NOTION_PAGE_IDS", page.replaceAll("-", "").toLowerCase(), /^[0-9a-f]{32}$/),
  );
  if (pages.length > 0) resources.notion = pages;
  return resources;
}

function commaList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

function checked(name: string, value: string, pattern: RegExp): string {
  if (!pattern.test(value)) {
    throw new Error(`${name} has an invalid entry "${value.slice(0, 80)}"`);
  }
  return value;
}

// Idempotent: every write is an upsert, all in one transaction.
export function seedLocalData(
  db: Db,
  resources: GatewayResources = {},
): { tenants: number; projects: number; users: number; gatewayPermissions: number } {
  const permissions = effectivePermissions(resources);
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
    for (const server of Object.keys(resources) as (keyof GatewayResources)[]) {
      deleteGatewayPermissions(db, REFERENCE_PROJECT, server);
    }
    for (const permission of permissions) {
      upsertGatewayPermission(db, permission);
    }
  }).immediate();

  return {
    tenants: TENANTS.length,
    projects: PROJECTS.length,
    users: USERS.length,
    gatewayPermissions: permissions.length,
  };
}

// The fictitious examples, minus the servers that the environment provides, plus the real resources.
function effectivePermissions(resources: GatewayResources): Permission[] {
  const examples = GATEWAY_PERMISSIONS.filter((permission) => !(permission.server in resources));
  const real = (Object.keys(resources) as (keyof GatewayResources)[]).flatMap((server) =>
    (resources[server] ?? []).map((resourceId) => ({
      projectSlug: REFERENCE_PROJECT,
      server,
      resourceType: RESOURCE_TYPES[server],
      resourceId,
    })),
  );
  return [...examples, ...real];
}

function tenantIdOf(tenantIds: Map<string, string>, slug: string): string {
  const id = tenantIds.get(slug);
  if (id === undefined) {
    throw new Error(`seed references unknown tenant ${slug}`);
  }
  return id;
}
