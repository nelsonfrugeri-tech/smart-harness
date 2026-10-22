import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildPersonalSkills } from "../build-personal-skills.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const binary = process.env.HARNESS_TEST_BINARY ?? join(root, "cli/bin/harness");
const expected = {
  md2poui: ["md2poui-cli-options", "md2poui-markdown-rendering", "md2poui-angular-generation"],
  "code-review": ["code-review"],
  "software-delivery": ["development-workflow", "code-review"],
};
const readArchive = (file, path) => execFileSync("tar", ["-xzOf", file, path], { encoding: "utf8" });

test("personal packages validate, generate, pack reproducibly and keep skills self-contained", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sh-personal-packages-test-"));
  try {
    const first = await buildPersonalSkills(binary, directory);
    assert.equal(first.length, 3);
    for (const item of first) {
      const published = await readFile(join(root, "control-plane/seed/packages", `${item.name}-${item.version}.tar.gz`));
      assert.deepEqual(await readFile(item.file), published, "published archive must match source and adapter");
      const paths = execFileSync("tar", ["-tzf", item.file], { encoding: "utf8" }).trim().split("\n");
      const plugin = JSON.parse(readArchive(item.file, ".claude-plugin/plugin.json"));
      assert.equal(plugin.name, item.name);
      assert.ok(plugin.keywords.includes("claude-code"));
      assert.ok(!paths.includes("mcp.json") && !paths.includes(".mcp.json"), "selected connectors own their endpoints");
      for (const skill of expected[item.name]) {
        assert.ok(paths.includes(`skills/${skill}/SKILL.md`));
        const canonicalPackage = skill === "code-review" ? "code-review" : item.name;
        const source = await readFile(join(root, "marketplace", canonicalPackage, "skills", skill, "SKILL.md"), "utf8");
        assert.equal(readArchive(item.file, `skills/${skill}/SKILL.md`), source);
      }
      if (item.name !== "software-delivery") {
        assert.ok(!paths.some((path) => path.startsWith("agents/")), "domain and review packages contain skills only");
      }
    }
    const delivery = first.find((item) => item.name === "software-delivery");
    for (const name of ["developer", "reviewer"]) {
      const agent = readArchive(delivery.file, `agents/${name}.md`);
      const frontmatter = agent.split("---")[1];
      assert.ok(frontmatter.includes("Skill"));
      assert.ok(frontmatter.includes("Bash"));
      assert.equal(frontmatter.includes("Edit"), name === "developer");
      assert.equal(frontmatter.includes("Write"), name === "developer");
      for (const connector of ["github", "trello", "notion", "graphify", "deja-vu"]) {
        assert.ok(frontmatter.includes(`mcp__plugin_${connector}_${connector}__*`), `missing selected connector ${connector}`);
      }
    }
    assert.deepEqual(await buildPersonalSkills(binary, directory), first);
    const altered = first[0].file;
    await writeFile(altered, "an already published different archive");
    await assert.rejects(buildPersonalSkills(binary, directory), /Published versions are immutable/);
    assert.equal(await readFile(altered, "utf8"), "an already published different archive");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
