import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildConnectors } from "../build-connectors.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const binary = process.env.HARNESS_TEST_BINARY ?? join(root, "cli/bin/harness");
const readArchive = (file, path) => execFileSync("tar", ["-xzOf", file, path], { encoding: "utf8" });

test("six connector packages are reproducible, immutable and contain only curated MCP configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sh-connectors-test-"));
  try {
    const first = await buildConnectors(binary, directory);
    assert.equal(first.length, 6);
    for (const item of first) {
      assert.deepEqual(await readFile(item.file), await readFile(join(root, "control-plane/seed/packages", `${item.name}-${item.version}.tar.gz`)));
      const paths = execFileSync("tar", ["-tzf", item.file], { encoding: "utf8" }).trim().split("\n");
      assert.ok(paths.includes(".mcp.json"));
      assert.ok(!paths.some((path) => path.startsWith("hooks/") || path.startsWith("skills/") || path.startsWith("agents/")));
      const manifest = JSON.parse(readArchive(item.file, ".claude-plugin/plugin.json"));
      assert.ok(manifest.keywords.includes("claude-code"));
      const servers = JSON.parse(readArchive(item.file, ".mcp.json")).mcpServers;
      assert.deepEqual(Object.keys(servers), [item.name]);
      const server = servers[item.name];
      if (["graphify", "deja-vu", "observability"].includes(item.name)) {
        assert.deepEqual(server, { type: "stdio", command: "${HARNESS_CLI_BIN}", args: ["tools", "serve", item.name] });
        assert.equal(item.version, item.name === "observability" ? "1.0.0" : "2.0.0");
      } else {
        assert.equal(server.type, "http");
        assert.equal(server.url, "${SMART_HARNESS_GATEWAY_URL:-http://127.0.0.1:8081}/mcp/me/" + item.name);
        assert.equal(server.headers.Authorization, "Bearer ${SMART_HARNESS_TOKEN}");
        assert.ok(!server.command);
      }
    }
    assert.deepEqual(await buildConnectors(binary, directory), first);
    await writeFile(first[0].file, "existing publication");
    await assert.rejects(buildConnectors(binary, directory), /Published versions are immutable/);
    assert.equal(await readFile(first[0].file, "utf8"), "existing publication");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
