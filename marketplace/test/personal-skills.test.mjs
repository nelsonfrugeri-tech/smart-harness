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
};
const readArchive = (file, path) => execFileSync("tar", ["-xzOf", file, path], { encoding: "utf8" });

test("personal packages validate, generate, pack reproducibly and keep skills self-contained", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sh-personal-packages-test-"));
  try {
    const first = await buildPersonalSkills(binary, directory);
    assert.deepEqual(first.map((item) => item.name), ["md2poui", "code-review"]);
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
        const source = await readFile(join(root, "marketplace", item.name, "skills", skill, "SKILL.md"), "utf8");
        assert.equal(readArchive(item.file, `skills/${skill}/SKILL.md`), source);
      }
      assert.ok(!paths.some((path) => path.startsWith("agents/") || path.startsWith("dev.smartharness/agents/")), "personal packages contain skills only");
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
