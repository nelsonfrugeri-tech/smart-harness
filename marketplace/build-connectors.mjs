import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
export const CONNECTORS = ["github", "trello", "notion", "graphify", "deja-vu"];

export async function buildConnectors(binary, outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  const results = [];
  for (const name of CONNECTORS) {
    const staging = await mkdtemp(join(tmpdir(), "sh-connector-"));
    try {
      const directory = join(staging, name);
      await cp(join(root, "marketplace/connectors", name), directory, { recursive: true });
      const run = (...args) => execFileSync(resolve(binary), args, { encoding: "utf8" });
      run("validate", directory, "--json");
      run("generate", directory, "--target", "claude-code");
      const report = JSON.parse(run("validate", directory, "--json"));
      const archive = join(staging, "package.tar.gz");
      const digest = run("pack", directory, "-o", archive).trim();
      const destination = join(outputDirectory, `${name}-${report.version}.tar.gz`);
      const bytes = await readFile(archive);
      let previous;
      try { previous = await readFile(destination); } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (previous && !previous.equals(bytes)) throw new Error(`Published versions are immutable: ${name}@${report.version}; bump the version.`);
      if (!previous) await writeFile(destination, bytes, { flag: "wx" });
      results.push({ name, version: report.version, digest, file: destination });
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const packages = await buildConnectors(process.argv[2] ?? join(root, "cli/bin/harness"),
    process.argv[3] ?? join(root, "control-plane/seed/packages"));
  for (const item of packages) process.stdout.write(`${item.name}@${item.version} ${item.digest}\n`);
}
