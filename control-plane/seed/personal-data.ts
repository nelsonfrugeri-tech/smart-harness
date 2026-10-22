import type { Db } from "../src/db/database.ts";
import { upsertMembership, upsertTenant, upsertUser } from "../src/db/repos/seed.ts";
import { demoResourcesFromEnv } from "./demo-data.ts";
import type { GatewayResources } from "./local-data.ts";

export const PERSONAL_TENANT = "smart-harness";
export const PERSONAL_DEV = "dev@smart-harness.local";
export const PERSONAL_ADMIN = "admin@smart-harness.local";
export { demoResourcesFromEnv as personalResourcesFromEnv };

// Creates no projects. Re-running replaces only this seed's personal connector grants.
// Existing project data, tokens, other users and other tenants are preserved.
export function seedPersonalData(db: Db, resources: GatewayResources = {}): { users: number; projects: number; gatewayPermissions: number } {
  let gatewayPermissions = 0;
  db.transaction(() => {
    const tenantId = upsertTenant(db, { slug: PERSONAL_TENANT, name: "Smart Harness" });
    const admin = upsertUser(db, { email: PERSONAL_ADMIN, name: "Marketplace Admin" });
    const developer = upsertUser(db, { email: PERSONAL_DEV, name: "Alex Morgan" });
    upsertMembership(db, admin, tenantId, "ADMIN");
    upsertMembership(db, developer, tenantId, "DEV");
    db.prepare("UPDATE users SET job_title = ? WHERE id = ?").run("Software Engineer", developer);
    const remove = db.prepare("DELETE FROM user_gateway_permissions WHERE user_id = ? AND tenant_id = ? AND server = ?");
    const grant = db.prepare(`INSERT INTO user_gateway_permissions (user_id, tenant_id, server, resource_type, resource_id)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`);
    for (const [server, resourceType] of Object.entries({ github: "repo", trello: "board", notion: "page" })) {
      remove.run(developer, tenantId, server);
      for (const resourceId of resources[server as keyof GatewayResources] ?? []) {
        gatewayPermissions += grant.run(developer, tenantId, server, resourceType, resourceId).changes;
      }
    }
  }).immediate();
  return { users: 2, projects: 0, gatewayPermissions };
}
