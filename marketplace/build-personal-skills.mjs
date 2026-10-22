import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PERSONAL_PACKAGES = ["md2poui", "code-review", "software-delivery"];

export async function buildPersonalSkills(binary, outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  const results = [];
  for (const name of PERSONAL_PACKAGES) {
    results.push(await buildPackage(name, resolve(binary), resolve(outputDirectory)));
  }
  return results;
}

async function buildPackage(name, binary, outputDirectory) {
  const source = join(root, "marketplace", name);
  const manifest = JSON.parse(await readFile(join(source, "plugin.json"), "utf8"));
  const destination = join(outputDirectory, `${manifest.name}-${manifest.version}.tar.gz`);
  const staging = await mkdtemp(join(tmpdir(), "sh-personal-skills-"));
  try {
    const directory = join(staging, "package");
    await cp(source, directory, { recursive: true });
    if (name === "software-delivery") {
      await cp(join(root, "marketplace/code-review/skills/code-review"), join(directory, "skills/code-review"), { recursive: true });
    }
    const run = (...args) => execFileSync(binary, args, { encoding: "utf8" });
    run("validate", directory, "--json");
    run("generate", directory, "--target", "claude-code");
    run("validate", directory, "--json");
    const archive = join(staging, "package.tar.gz");
    const digest = run("pack", directory, "-o", archive).trim();
    const bytes = await readFile(archive);
    let previous;
    try {
      previous = await readFile(destination);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (previous && !previous.equals(bytes)) {
      throw new Error(`Published versions are immutable: ${manifest.name}@${manifest.version}; bump the version.`);
    }
    if (!previous) {
      const pending = `${destination}.pending`;
      await cp(archive, pending, { errorOnExist: true, force: false });
      await rename(pending, destination);
    }
    return { name: manifest.name, version: manifest.version, digest, file: destination };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const packages = await buildPersonalSkills(
    process.argv[2] ?? join(root, "cli/bin/harness"),
    process.argv[3] ?? join(root, "control-plane/seed/packages"),
  );
  for (const item of packages) process.stdout.write(`${item.name}@${item.version} ${item.digest}\n`);
}
