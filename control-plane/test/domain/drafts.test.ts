import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDraft, DraftFilesError, filesProblems, pathProblem } from "../../src/domain/drafts.ts";
import { FakeHarness } from "../test-support.ts";

describe("pathProblem", () => {
  it.each(["plugin.json", "skills/a/SKILL.md", "dev.smartharness/agents/x.agent.md", ".mcp.json"])("accepts %s", (path) => {
    expect(pathProblem(path)).toBeUndefined();
  });

  it.each(["", "/abs", "../x", "a/../../x", "a/..", "./a", "a//b", "a/", "a\\b", "C:x", "a\0b", "x".repeat(513)])(
    "refuses %j",
    (path) => {
      expect(pathProblem(path)).toEqual(expect.any(String));
    },
  );
});

describe("filesProblems", () => {
  it("reports every bad index and the first size problem", () => {
    const result = filesProblems([
      { path: "ok.md", content: "x" },
      { path: "../x", content: "x" },
      { path: "ok.md", content: "x" },
    ]);
    expect(result.paths.map((problem) => problem.index)).toEqual([1, 2]);
    expect(result.tooLarge).toBeUndefined();
  });
});

describe("buildDraft", () => {
  let sandbox: string;
  let previousTmp: string | undefined;

  // A private TMPDIR: the test can prove that nothing was created in it.
  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "draft-sandbox-"));
    previousTmp = process.env.TMPDIR;
    process.env.TMPDIR = sandbox;
  });

  afterEach(() => {
    if (previousTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmp;
    rmSync(sandbox, { recursive: true, force: true });
  });

  it.each(["../escape.txt", join(tmpdir(), "draft-absolute-escape.txt"), "skills/../../escape.txt"])(
    "refuses %s before creating any directory or file",
    async (badPath) => {
      const harness = new FakeHarness();
      const files = [
        { path: "plugin.json", content: '{"name":"demo","version":"1.0.0"}' },
        { path: badPath, content: "escaped" },
      ];

      await expect(buildDraft(harness, files)).rejects.toBeInstanceOf(DraftFilesError);

      expect(tmpdir()).toBe(sandbox);
      expect(readdirSync(sandbox)).toEqual([]);
      expect(existsSync(join(sandbox, "..", "escape.txt"))).toBe(false);
      expect(existsSync(join(tmpdir(), "draft-absolute-escape.txt"))).toBe(false);
      expect(harness.calls).toEqual([]);
    },
  );

  it("builds a valid draft and removes its temporary directory", async () => {
    const harness = new FakeHarness();
    const result = await buildDraft(harness, [
      { path: "plugin.json", content: '{"name":"demo","version":"1.0.0","description":"Demo."}' },
      { path: "skills/demo-skill/SKILL.md", content: "body" },
    ]);

    expect(result.report.valid).toBe(true);
    expect(result.prepared?.manifest).toEqual({
      name: "demo",
      version: "1.0.0",
      description: "Demo.",
      keywords: [],
      components: [{ kind: "skill", name: "demo-skill", description: "From the report." }],
    });
    expect(result.prepared?.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(readdirSync(sandbox)).toEqual([]);
  });
});
