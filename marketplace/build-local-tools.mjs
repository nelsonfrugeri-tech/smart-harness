// Build curated skill packages without including upstream executables or local history.
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const binary = resolve(process.argv[2] ?? join(root, "cli/bin/harness"));
const output = join(root, "control-plane/seed/packages");
await mkdir(output, { recursive: true });
for (const name of ["graphify", "deja-vu"]) {
  const staging = await mkdtemp(join(tmpdir(), "sh-local-tool-package-"));
  try {
    const source = join(root, "marketplace/local-tools", name);
    const directory = join(staging, name);
    await cp(source, directory, { recursive: true });
    const run = (...args) => execFileSync(binary, args, { encoding: "utf8" });
    run("validate", directory, "--json");
    run("generate", directory, "--target", "claude-code");
    const report = JSON.parse(run("validate", directory, "--json"));
    const archive = join(staging, "package.tar.gz");
    const digest = run("pack", directory, "-o", archive).trim();
    const destination = join(output, `${name}-${report.version}.tar.gz`);
    const bytes = await readFile(archive);
    let existing;
    try { existing = await readFile(destination); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (existing && !existing.equals(bytes)) throw new Error(`Published fixture ${name}@${report.version} is immutable`);
    if (!existing) await writeFile(destination, bytes, { flag: "wx" });
    process.stdout.write(`${name}@${report.version} ${digest}\n`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
