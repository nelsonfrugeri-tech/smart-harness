import type { Db } from "../src/db/database.ts";
import { deleteGatewayPermissions, tenantIdBySlug, upsertGatewayPermission, upsertProject } from "../src/db/repos/seed.ts";
import { gatewayResourcesFromEnv, type GatewayResources } from "./local-data.ts";

// Demo permissions are separate from the original sample project and default to deny.
export function demoResourcesFromEnv(env: NodeJS.ProcessEnv = process.env): GatewayResources {
  return gatewayResourcesFromEnv({
    GITHUB_REPOS: env.DEMO_GITHUB_REPO,
    TRELLO_BOARD_ID: env.DEMO_TRELLO_BOARD_ID,
    NOTION_PAGE_IDS: env.DEMO_NOTION_PAGE_IDS,
  });
}

export function seedDemoData(db: Db, resources: GatewayResources = {}): void {
  db.transaction(() => {
    upsertProject(db, tenantIdBySlug(db, "investimentos"), {
      slug: "md2poui",
      name: "TOTVS md2poui",
      description: "TypeScript CLI demo: turn Markdown into PO-UI components.",
    });
    for (const [server, resourceType] of Object.entries({ github: "repo", trello: "board", notion: "page" })) {
      deleteGatewayPermissions(db, "md2poui", server);
      for (const resourceId of resources[server as keyof GatewayResources] ?? []) {
        upsertGatewayPermission(db, { projectSlug: "md2poui", server, resourceType, resourceId });
      }
    }
  }).immediate();
}
