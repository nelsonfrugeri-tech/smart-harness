import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createPackageStorage } from "../../src/storage/packages.ts";
import { FakeS3, seededDatabase, TEST_BUCKET } from "../test-support.ts";
import { FIXTURES, PACKAGES_DIR, seedMarketplace } from "../../seed/marketplace.ts";

// Expected archive paths of each declared component, in the package layout of the ADR.
function expectedPaths(kind: string, name: string): string[] {
  if (kind === "skill") return [`skills/${name}/SKILL.md`];
  if (kind === "agent") return [`dev.smartharness/agents/${name}.agent.md`, `agents/${name}.md`];
  return ["mcp.json", ".mcp.json"];
}

describe("marketplace fixtures", () => {
  it.each(FIXTURES)("$file contains what its manifest declares", (fixture) => {
    const file = `${PACKAGES_DIR}${fixture.file}`;
    const paths = execFileSync("tar", ["-tzf", file], { encoding: "utf8" }).trim().split("\n");
    const plugin = JSON.parse(execFileSync("tar", ["-xzOf", file, "plugin.json"], { encoding: "utf8" }));

    if (fixture.manifest.keywords !== undefined) expect(plugin.keywords).toEqual(fixture.manifest.keywords);
    expect(plugin).toMatchObject({ name: fixture.manifest.name, version: fixture.manifest.version });
    expect(paths).toContain(".claude-plugin/plugin.json");
    for (const component of fixture.manifest.components) {
      for (const path of expectedPaths(component.kind, component.name)) {
        expect(paths, `${component.kind} ${component.name}`).toContain(path);
      }
    }
  });
});

describe("seedMarketplace", () => {
  it("publishes every fixture once and is idempotent in the database and the bucket", async () => {
    const db = seededDatabase();
    const s3 = new FakeS3([TEST_BUCKET]);
    const storage = createPackageStorage(s3, TEST_BUCKET);

    const first = await seedMarketplace({ db, storage });
    const second = await seedMarketplace({ db, storage });

    expect(first).toEqual({ created: 12, unchanged: 0, storedArchives: 12, baseline: 4 });
    expect(second).toEqual({ created: 0, unchanged: 12, storedArchives: 0, baseline: 4 });
    expect(s3.keys(TEST_BUCKET)).toHaveLength(12);
    expect(db.prepare("SELECT count(*) AS n FROM plugin_versions").get()).toEqual({ n: 12 });
    expect(db.prepare("SELECT count(*) AS n FROM project_baseline").get()).toEqual({ n: 4 });
    db.close();
  });

  it("refuses to run before the local seed created the publisher", async () => {
    const db = seededDatabase();
    db.prepare("DELETE FROM users WHERE email = 'admin@smart-harness.local'").run();

    await expect(
      seedMarketplace({ db, storage: createPackageStorage(new FakeS3([TEST_BUCKET]), TEST_BUCKET) }),
    ).rejects.toThrow("run npm run seed first");
    db.close();
  });
});
