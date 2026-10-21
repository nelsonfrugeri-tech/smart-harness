import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCliHarnessClient, parseReport } from "../../src/harness/cli-client.ts";

// A stand-in `harness` binary: echoes its argv so the test sees exactly what was executed.
const FAKE_HARNESS = `#!/usr/bin/env node
const { createHash } = require("node:crypto");
const { writeFileSync } = require("node:fs");
const [command, dir, ...rest] = process.argv.slice(2);
if (command === "validate") {
  const valid = !dir.includes("invalid");
  console.log(JSON.stringify({ valid, findings: [{ code: "ARGV", message: JSON.stringify(process.argv.slice(2)) }] }));
  process.exit(valid ? 0 : 1);
}
if (command === "generate") {
  writeFileSync(dir + "/generated.json", JSON.stringify(process.argv.slice(2)));
  process.exit(0);
}
if (command === "pack") {
  const bytes = Buffer.from("archive of " + dir);
  writeFileSync(rest[1], bytes);
  console.log(process.env.FAKE_PACK_OUTPUT ?? "sha256:" + createHash("sha256").update(bytes).digest("hex"));
  process.exit(0);
}
console.error("unknown command " + command);
process.exit(2);
`;

describe("createCliHarnessClient", () => {
  let dir: string;
  let binary: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "harness-cli-"));
    binary = join(dir, "harness");
    writeFileSync(binary, FAKE_HARNESS);
    chmodSync(binary, 0o755);
    delete process.env.FAKE_PACK_OUTPUT;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.FAKE_PACK_OUTPUT;
  });

  it("passes arguments without a shell: spaces and ; stay inside one argument", async () => {
    const packageDir = join(dir, "my pkg; touch pwned");
    mkdirSync(packageDir);

    const report = await createCliHarnessClient(binary).validate(packageDir);

    expect(report.valid).toBe(true);
    expect(JSON.parse(report.findings[0].message)).toEqual(["validate", packageDir, "--json"]);
    expect(existsSync(join(dir, "pwned"))).toBe(false);
  });

  it("returns the report of an invalid package even though the binary exits non-zero", async () => {
    const packageDir = join(dir, "invalid");
    mkdirSync(packageDir);

    const report = await createCliHarnessClient(binary).validate(packageDir);

    expect(report.valid).toBe(false);
  });

  it("accepts report v2 metadata and preserves absence for legacy report fallback", async () => {
    const legacy = await createCliHarnessClient(binary).validate(dir);
    expect(legacy.description).toBeUndefined();
    expect(legacy.keywords).toBeUndefined();
    writeFileSync(binary, '#!/usr/bin/env node\nconsole.log(JSON.stringify({report_version:"2",valid:true,description:"Review",keywords:["Go"],findings:[]}));\n');
    expect(await createCliHarnessClient(binary).validate(dir)).toMatchObject({ description: "Review", keywords: ["Go"] });
  });

  it("rejects malformed report metadata instead of storing it", async () => {
    writeFileSync(binary, '#!/usr/bin/env node\nconsole.log(JSON.stringify({valid:true,keywords:[42],findings:[]}));\n');
    await expect(createCliHarnessClient(binary).validate(dir)).rejects.toThrow("unexpected report");
  });

  it("runs generate with the target", async () => {
    await createCliHarnessClient(binary).generate(dir, "claude-code");

    expect(JSON.parse(readFileSync(join(dir, "generated.json"), "utf8"))).toEqual(["generate", dir, "--target", "claude-code"]);
  });

  it("runs pack with -o and returns the printed digest", async () => {
    const out = join(dir, "out.tar.gz");

    const { digest } = await createCliHarnessClient(binary).pack(dir, out);

    expect(digest).toBe(`sha256:${createHash("sha256").update(readFileSync(out)).digest("hex")}`);
  });

  it("fails when pack prints something that is not a digest", async () => {
    process.env.FAKE_PACK_OUTPUT = "done";

    await expect(createCliHarnessClient(binary).pack(dir, join(dir, "out.tar.gz"))).rejects.toThrow("unexpected digest");
  });

  it("fails on an unknown binary or command error", async () => {
    await expect(createCliHarnessClient(join(dir, "missing")).generate(dir, "claude-code")).rejects.toThrow();
  });
});

describe("parseReport", () => {
  it("keeps findings, components and report v2 metadata, and drops the raw-tree digest", () => {
    const report = parseReport(
      JSON.stringify({
        report_version: "2",
        description: "Package description",
        keywords: ["review"],
        valid: false,
        plugin: "demo",
        version: "1.0.0",
        digest: `sha256:${"a".repeat(64)}`,
        components: [{ kind: "skill", name: "s", description: "Skill." }],
        findings: [{ code: "SH-1", severity: "error", message: "bad", hint: "fix it", path: "a.md", line: 3 }],
      }),
    );

    expect(report).toEqual({
      description: "Package description",
      keywords: ["review"],
      valid: false,
      plugin: "demo",
      version: "1.0.0",
      components: [{ kind: "skill", name: "s", description: "Skill." }],
      findings: [{ code: "SH-1", severity: "error", message: "bad", hint: "fix it", path: "a.md", line: 3 }],
    });
  });

  it.each(["not json", "null", "[]", '{"findings":[]}'])("returns undefined for %s", (output) => {
    expect(parseReport(output)).toBeUndefined();
  });
});
