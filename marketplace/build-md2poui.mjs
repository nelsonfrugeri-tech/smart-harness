import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binary = resolve(process.argv[2] ?? join(root, "cli/bin/harness"));
for (const name of ["md2poui-base", "md2poui-development", "md2poui-review"]) {
  const source = join(root, "marketplace", name);
  const manifest = JSON.parse(await readFile(join(source, "plugin.json"), "utf8"));
  const destination = join(root, "control-plane/seed/packages", `${manifest.name}-${manifest.version}.tar.gz`);
  const staging = await mkdtemp(join(tmpdir(), "sh-md2poui-package-"));

  try {
    const directory = join(staging, "package");
    await cp(source, directory, { recursive: true });
    if (name !== "md2poui-base") {
      await cp(join(root, "marketplace/md2poui-base/skills", name), join(directory, "skills", name), { recursive: true });
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
      throw new Error("Published versions are immutable; bump plugin.json version before rebuilding different bytes.");
    }
    if (!previous) {
      const pending = `${destination}.pending`;
      await cp(archive, pending, { errorOnExist: true, force: false });
      await rename(pending, destination);
    }
    process.stdout.write(`${manifest.name}@${manifest.version} ${digest}\n`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
