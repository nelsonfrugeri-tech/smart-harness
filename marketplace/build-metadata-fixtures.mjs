// Add tagged fixture versions without rewriting any published archive.
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const binary = resolve(process.argv[2] ?? join(root, "cli/bin/harness"));
const packages = join(root, "control-plane/seed/packages");
const variants = [
  ["investimentos-base", "1.2.1", "1.2.2", ["investimentos", "onboarding", "go"]],
  ["conta-base", "1.0.0", "1.0.1", ["conta", "onboarding"]],
  ["cartoes-base", "1.0.0", "1.0.1", ["cartoes", "onboarding"]],
  ["code-review", "1.0.0", "1.0.1", ["review", "quality"]],
  ["github-connector", null, "1.0.0", ["github", "integration"]],
];
for (const [name, previous, version, keywords] of variants) {
  const staging = await mkdtemp(join(tmpdir(), "sh-metadata-fixture-"));
  try {
    const directory = join(staging, "package");
    await mkdir(directory);
    if (previous) execFileSync("tar", ["-xzf", join(packages, `${name}-${previous}.tar.gz`), "-C", directory]);
    const manifest = previous
      ? JSON.parse(await readFile(join(directory, "plugin.json"), "utf8"))
      : { $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name,
          description: "GitHub connector through the Investimentos project gateway.", author: { name: "Squad Investimentos" } };
    await writeFile(join(directory, "plugin.json"), JSON.stringify({ ...manifest, version, keywords }, null, 2) + "\n");
    if (name === "conta-base") {
      const path = join(directory, "mcp.json");
      const mcp = JSON.parse(await readFile(path, "utf8"));
      mcp.mcpServers.github.url = "http://127.0.0.1:8081/mcp/projects/conta-digital/github";
      await writeFile(path, JSON.stringify(mcp, null, 2) + "\n");
    }
    if (!previous) {
      await writeFile(join(directory, "mcp.json"), JSON.stringify({
        $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
        mcpServers: { github: { type: "streamable-http", url: "http://127.0.0.1:8081/mcp/projects/investimentos-api/github" } },
      }, null, 2) + "\n");
    }
    const run = (...args) => execFileSync(binary, args, { encoding: "utf8" });
    for (const generated of [".claude-plugin", "agents", ".mcp.json"]) {
      await rm(join(directory, generated), { recursive: true, force: true });
    }
    run("validate", directory, "--json");
    run("generate", directory, "--target", "claude-code");
    run("validate", directory, "--json");
    const archive = join(staging, "package.tar.gz");
    const digest = run("pack", directory, "-o", archive).trim();
    const destination = join(packages, `${name}-${version}.tar.gz`);
    const bytes = await readFile(archive);
    let existing;
    try { existing = await readFile(destination); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (existing && !existing.equals(bytes)) throw new Error(`Published fixture ${name}@${version} is immutable`);
    if (!existing) await writeFile(destination, bytes, { flag: "wx" });
    process.stdout.write(`${name}@${version} ${digest}\n`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
