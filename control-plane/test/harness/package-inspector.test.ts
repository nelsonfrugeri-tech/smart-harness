import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPackageInspector } from "../../src/harness/package-inspector.ts";
import { digestOf } from "../../src/domain/marketplace.ts";

const run = promisify(execFile);

describe("release package inspector with the real Harness engine", () => {
  let work: string;
  let binary: string;
  beforeAll(async () => {
    work = await mkdtemp(join(tmpdir(), "github-inspector-test-"));
    binary = join(work, "harness");
    await run("go", ["build", "-o", binary, "./cmd/harness"], { cwd: fileURLToPath(new URL("../../../cli/", import.meta.url)), timeout: 60_000 });
  }, 70_000);
  afterAll(async () => { if (work) await rm(work, { recursive: true, force: true }); });

  async function packed(generated: boolean, version = "1.0.0") {
    const source = await mkdtemp(join(work, "source-"));
    await mkdir(join(source, "skills", "onboarding"), { recursive: true });
    await writeFile(join(source, "plugin.json"), JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "agent-demo", version, description: "Project helper" }));
    await writeFile(join(source, "skills", "onboarding", "SKILL.md"), "---\nname: onboarding\ndescription: Explain the project and its conventions.\n---\nRead the README and verify the project commands.\n");
    if (generated) await run(binary, ["generate", source, "--target", "claude-code"]);
    const archiveFile = source + ".tar.gz";
    await run(binary, ["pack", source, "-o", archiveFile]);
    return readFile(archiveFile);
  }

  it("reads a generated package and preserves engine component descriptions", async () => {
    const archive = await packed(true);
    expect(await createPackageInspector(binary)(archive, digestOf(archive))).toMatchObject({
      name: "agent-demo", version: "1.0.0", components: [{ kind: "skill", name: "onboarding", description: "Explain the project and its conventions." }],
    });
  });

  it("refuses a source-only archive that would install without the Claude plugin layer", async () => {
    const archive = await packed(false);
    await expect(createPackageInspector(binary)(archive, digestOf(archive))).rejects.toMatchObject({ status: 422, code: "missing_generated_layer" });
  });

  it("rejects corrupt archives and digest mismatches through safe unpack", async () => {
    const corrupt = Buffer.from("not gzip");
    await expect(createPackageInspector(binary)(corrupt, digestOf(corrupt))).rejects.toMatchObject({ status: 422, code: "invalid_archive" });
    const archive = await packed(true);
    await expect(createPackageInspector(binary)(archive, `sha256:${"a".repeat(64)}`)).rejects.toMatchObject({ status: 422, code: "invalid_archive" });
  });
});
