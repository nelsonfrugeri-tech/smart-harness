import { describe, expect, it } from "vitest";
import { demoResourcesFromEnv, seedDemoData } from "../../seed/demo-data.ts";
import { seededDatabase } from "../test-support.ts";

describe("md2poui demo seed", () => {
  it("defaults to deny, isolates sample permissions, replaces and revokes demo resources", () => {
    const db = seededDatabase();
    try {
      const sample = db.prepare("SELECT * FROM gateway_permissions ORDER BY project_id, server, resource_id").all();
      const permissions = () => db.prepare(`SELECT g.server, g.resource_id FROM gateway_permissions g
        JOIN projects p ON p.id = g.project_id WHERE p.slug = 'md2poui' ORDER BY g.server`).all();
      seedDemoData(db);
      expect(permissions()).toEqual([]);
      const project = db.prepare("SELECT id FROM projects WHERE slug = 'md2poui'").get();
      const resources = demoResourcesFromEnv({
        DEMO_GITHUB_REPO: "nelsonfrugeri-tech/md2poui",
        DEMO_TRELLO_BOARD_ID: "DemoBoard1",
        DEMO_NOTION_PAGE_IDS: "1A2B3C4D-1111-2222-3333-444455556666",
      });
      seedDemoData(db, resources);
      seedDemoData(db, resources);
      expect(permissions()).toEqual([
        { server: "github", resource_id: "nelsonfrugeri-tech/md2poui" },
        { server: "notion", resource_id: "1a2b3c4d111122223333444455556666" },
        { server: "trello", resource_id: "DemoBoard1" },
      ]);
      expect(db.prepare("SELECT id FROM projects WHERE slug = 'md2poui'").get()).toEqual(project);
      seedDemoData(db, { github: ["nelsonfrugeri-tech/another-demo"] });
      expect(permissions()).toEqual([{ server: "github", resource_id: "nelsonfrugeri-tech/another-demo" }]);
      seedDemoData(db);
      expect(permissions()).toEqual([]);
      expect(db.prepare("SELECT * FROM gateway_permissions ORDER BY project_id, server, resource_id").all()).toEqual(sample);
    } finally {
      db.close();
    }
  });

  it("ignores legacy resource variables and rejects malformed demo identifiers", () => {
    expect(demoResourcesFromEnv({ GITHUB_REPOS: "private/unrelated" })).toEqual({});
    expect(() => demoResourcesFromEnv({ DEMO_GITHUB_REPO: "https://github.com/totvs/md2poui" })).toThrow();
    expect(() => demoResourcesFromEnv({ DEMO_TRELLO_BOARD_ID: "bad/board" })).toThrow();
    expect(() => demoResourcesFromEnv({ DEMO_NOTION_PAGE_IDS: "bad-page" })).toThrow();
  });
});
