import { describe, expect, it } from "vitest";
import { listMembershipsOfUser } from "../../src/db/repos/identity.ts";
import { seededDatabase, userId } from "../test-support.ts";
import { seedLocalData } from "../../seed/local-data.ts";

function counts(db: ReturnType<typeof seededDatabase>) {
  return db
    .prepare(
      `SELECT (SELECT count(*) FROM tenants) AS tenants, (SELECT count(*) FROM projects) AS projects,
              (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM memberships) AS memberships`,
    )
    .get();
}

describe("seedLocalData", () => {
  it("creates three tenants, one project each, one ADMIN and two DEVs", () => {
    const db = seededDatabase();

    expect(counts(db)).toEqual({ tenants: 3, projects: 3, users: 3, memberships: 6 });
    const roles = (email: string) =>
      listMembershipsOfUser(db, userId(db, email)).map((m) => `${m.tenant.slug}:${m.role}`);
    expect(roles("admin@smart-harness.local")).toEqual(["cartoes:ADMIN", "conta:ADMIN", "investimentos:ADMIN"]);
    expect(roles("dev@smart-harness.local")).toEqual(["conta:DEV", "investimentos:DEV"]);
    expect(roles("dev.cartoes@smart-harness.local")).toEqual(["cartoes:DEV"]);
    db.close();
  });

  it("allows project context and external resources only for investimentos-api", () => {
    const db = seededDatabase();

    const rows = db
      .prepare(
        `SELECT p.slug AS project, g.server, g.resource_type AS type
           FROM gateway_permissions g JOIN projects p ON p.id = g.project_id ORDER BY g.server`,
      )
      .all();

    expect(rows).toEqual([
      { project: "investimentos-api", server: "echo", type: "item" },
      { project: "investimentos-api", server: "github", type: "repo" },
      { project: "investimentos-api", server: "notion", type: "page" },
      { project: "investimentos-api", server: "project", type: "project" },
      { project: "investimentos-api", server: "trello", type: "board" },
    ]);
    db.close();
  });

  it("replaces sample service grants without retaining previously configured resources", () => {
    const db = seededDatabase();
    try {
      seedLocalData(db, { githubRepo: "example/first", trelloBoard: "firstboard", notionPage: "firstpage" });
      seedLocalData(db, { githubRepo: "example/second", trelloBoard: "secondboard", notionPage: "secondpage" });
      const rows = db.prepare("SELECT server, resource_id AS id FROM gateway_permissions ORDER BY server").all();
      expect(rows).toEqual([
        { server: "echo", id: "demo-item" },
        { server: "github", id: "example/second" },
        { server: "notion", id: "secondpage" },
        { server: "project", id: "investimentos-api" },
        { server: "trello", id: "secondboard" },
      ]);
    } finally { db.close(); }
  });

  it("is idempotent: a second run keeps the same rows and ids", () => {
    const db = seededDatabase();
    const before = db.prepare("SELECT id, slug FROM tenants ORDER BY slug").all();

    seedLocalData(db);

    expect(counts(db)).toEqual({ tenants: 3, projects: 3, users: 3, memberships: 6 });
    expect(db.prepare("SELECT id, slug FROM tenants ORDER BY slug").all()).toEqual(before);
    db.close();
  });
});
