import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { digestOf, PublishError } from "../domain/marketplace.ts";
import { readManifest } from "../domain/publish.ts";
import { RepositoryError, type PackageInspector } from "../domain/repositories.ts";
import { createCliHarnessClient } from "./cli-client.ts";

const run = promisify(execFile);

// Uses the existing engine's bounded, traversal-safe unpack and policy validator. Commands
// inspect declarative files only; no package hooks, scripts, MCPs or agents are executed.
export function createPackageInspector(binary = "harness"): PackageInspector {
  const harness = createCliHarnessClient(binary);
  return async (archive, digest) => {
    const work = await mkdtemp(join(tmpdir(), "harness-github-"));
    try {
      const file = join(work, "package.tar.gz");
      const dir = join(work, "package");
      await writeFile(file, archive);
      try {
        await run(binary, ["unpack", file, dir, "--expect-digest", digest], { timeout: 60_000, maxBuffer: 1024 * 1024 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
        throw new RepositoryError(422, "invalid_archive", "archive failed safe extraction; publish a package built by harness pack");
      }
      const report = await harness.validate(dir);
      if (!report.valid) throw new PublishError("invalid_package", "release package failed harness validation", report.findings);
      const manifest = await readManifest(dir, report);
      const before = await treeDigests(dir);
      await harness.generate(dir, "claude-code");
      if (JSON.stringify(before) !== JSON.stringify(await treeDigests(dir))) {
        throw new RepositoryError(422, "missing_generated_layer", "run harness generate --target claude-code before harness pack");
      }
      return { ...manifest, components: report.components ?? manifest.components };
    } finally { await rm(work, { recursive: true, force: true }); }
  };
}

async function treeDigests(dir: string): Promise<[string, string][]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files: [string, string][] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files.push([path.slice(dir.length + 1), digestOf(await readFile(path))]);
  }
  return files.sort(([a], [b]) => a.localeCompare(b));
}
