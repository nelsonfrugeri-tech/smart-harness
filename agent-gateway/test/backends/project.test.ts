import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/mcp/backend.ts";
import { createProjectBackend } from "../../src/backends/project/index.ts";

const ctx: ToolContext = {
  userId: "user", project: { id: "p1", slug: "sample", tenantId: "tenant" },
  server: "project", correlationId: "call", allowedResources: { project: ["sample"] },
};
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "project-backend-"));
  directories.push(root);
  for (const category of ["adr", "backlog", "delivered"]) {
    await mkdir(join(root, "sample", "docs", category), { recursive: true });
  }
  await writeFile(join(root, "sample", "README.md"), "# Sample\nProject overview.");
  await writeFile(join(root, "sample", "project.yaml"), "id: sample-id\nname: Sample\nsummary: Example project\nstack: [Node]\ncomponents:\n  - name: api\n    path: src/api\n    summary: API service\n");
  const backend = createProjectBackend({ root, projects: { sample: "sample" } });
  async function call(name: string, args: Record<string, unknown> = {}) {
    const result = await backend.callTool(ctx, name, args);
    const content = result.content[0];
    if (content.type !== "text") throw new Error("Expected text response");
    expect(content.text.length).toBeLessThanOrEqual(8000);
    return { result, value: JSON.parse(content.text) as Record<string, unknown> };
  }
  return { root, backend, call };
}

describe("project backend", () => {
  it("declares all tools against the authenticated project", async () => {
    const { backend, call } = await fixture();
    const tools = await backend.listTools(ctx);
    expect(tools.map((tool) => tool.name)).toEqual(["project_overview", "decisions_search", "backlog_list", "backlog_get", "delivered_list"]);
    for (const tool of tools) {
      expect(tool.access?.resourceType).toBe("project");
      if (tool.access?.kind !== "resource") throw new Error("Expected resource access");
      expect(tool.access.extract({ project: "other" })).toBe("sample");
    }
    const { value } = await call("project_overview");
    expect(value.source).toBe("examples/sample/README.md");
    expect(value.id).toBe("sample-id");
    expect(value.sources).toEqual(["examples/sample/project.yaml", "examples/sample/README.md"]);
    expect(value.manifest).toMatchObject({ id: "sample-id", name: "Sample", stack: ["Node"] });
    expect(value.content).toContain("Project overview");
  });

  it("preserves every item and its source across size-limited pages", async () => {
    const { root, call } = await fixture();
    for (let index = 0; index < 9; index++) {
      await writeFile(join(root, "sample/docs/backlog", `BL-${index}.md`),
        `---\nid: BL-${index}\ntitle: Item ${index}\nstatus: ready\npriority: high\nlabels: [api]\nrelated_decisions: []\n---\n${'"\\\n'.repeat(5000)}`);
    }
    const ids: string[] = [];
    let cursor: unknown;
    do {
      const { value } = await call("backlog_list", { limit: 9, ...(cursor ? { cursor } : {}) });
      const items = value.items as { id: string; source: string }[];
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.source).toBe(`examples/sample/docs/backlog/${item.id}.md`);
        ids.push(item.id);
      }
      cursor = value.next_cursor;
    } while (cursor);
    expect(ids).toEqual(Array.from({ length: 9 }, (_, index) => `BL-${index}`));
  });

  it("filters parsed YAML decisions and delivered metadata", async () => {
    const { root, call } = await fixture();
    await writeFile(join(root, "sample/docs/adr/ADR-1.md"), '---\nid: ADR-1\ntitle: "Storage: keys"\nstatus: accepted\ndate: "2026-10-21"\ntags:\n  - database\n---\nNo scan.');
    const { value } = await call("decisions_search", { query: "STORAGE" });
    expect((value.items as { id: string }[]).map((item) => item.id)).toEqual(["ADR-1"]);
    expect((await call("decisions_search", { query: "missing" })).value.items).toEqual([]);
    expect((await call("delivered_list")).value.items).toEqual([]);
    await writeFile(join(root, "sample/docs/delivered/DL-1.md"), '---\nid: DL-1\ntitle: Delivered\ndelivered_at: "2026-10-21"\nbacklog_id: BL-1\n---\nDone.');
    const deliveries = (await call("delivered_list")).value.items as { metadata: Record<string, unknown>; source: string }[];
    expect(deliveries[0].metadata.backlog_id).toBe("BL-1");
    expect(deliveries[0].source).toBe("examples/sample/docs/delivered/DL-1.md");
  });

  it("truncates overview and individual items as valid JSON while retaining identity", async () => {
    const { root, call } = await fixture();
    const longText = '"\\\n'.repeat(12000);
    await writeFile(join(root, "sample/README.md"), longText);
    const overview = (await call("project_overview")).value;
    expect(overview.truncated).toBe(true);
    expect(overview.source).toBe("examples/sample/README.md");
    expect(overview.id).toBe("sample-id");
    expect(overview.manifest).toMatchObject({ source: "examples/sample/project.yaml", summary: "Example project" });
    await writeFile(join(root, "sample/docs/backlog/BL-1.md"), `---\nid: BL-1\ntitle: Test\nstatus: ready\n---\n${longText}`);
    const item = (await call("backlog_get", { id: "BL-1" })).value;
    expect(item.id).toBe("BL-1");
    expect(item.source).toBe("examples/sample/docs/backlog/BL-1.md");
    expect(item.truncated).toBe(true);
    expect((await call("backlog_list", { status: "done" })).value.items).toEqual([]);
  });

  it("rejects cursors from another query and changed document snapshots", async () => {
    const { root, call } = await fixture();
    for (const id of ["ADR-1", "ADR-2"]) {
      await writeFile(join(root, "sample/docs/adr", `${id}.md`), `---\nid: ${id}\ntitle: Decision\n---\nStorage`);
    }
    const cursor = (await call("decisions_search", { query: "Storage", limit: 1 })).value.next_cursor;
    expect(typeof cursor).toBe("string");
    expect((await call("decisions_search", { query: "Decision", cursor })).result.isError).toBe(true);
    await writeFile(join(root, "sample/docs/adr/ADR-2.md"), "---\nid: ADR-2\ntitle: Decision\n---\nStorage changed");
    expect((await call("decisions_search", { query: "Storage", cursor })).result.isError).toBe(true);
  });

  it("rejects mappings and directory links that escape the project", async () => {
    const { root, backend } = await fixture();
    const escaped = createProjectBackend({ root, projects: { sample: "../" } });
    expect((await escaped.callTool(ctx, "project_overview", {})).isError).toBe(true);
    await rm(join(root, "sample/docs/adr"), { recursive: true });
    await symlink(root, join(root, "sample/docs/adr"));
    expect((await backend.callTool(ctx, "decisions_search", { query: "secret" })).isError).toBe(true);
  });

  it("rejects invalid arguments, unknown projects, missing documents and unsafe paths", async () => {
    const { root, backend, call } = await fixture();
    for (const args of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { limit: null }, { limit: "1" }, { cursor: "invalid" }, { cursor: "999" }]) {
      expect((await call("backlog_list", args)).result.isError).toBe(true);
    }
    expect((await call("backlog_get", { id: "../README" })).result.isError).toBe(true);
    expect((await call("backlog_get", { id: "BL-missing" })).result.isError).toBe(true);
    expect((await backend.callTool({ ...ctx, project: { ...ctx.project, slug: "unknown" } }, "project_overview", {})).isError).toBe(true);
    await symlink(join(root, "sample/README.md"), join(root, "sample/docs/backlog/BL-link.md"));
    expect((await call("backlog_list")).result.isError).toBe(true);
  });

  it("rejects invalid metadata and executable YAML tags", async () => {
    const { root, call } = await fixture();
    const path = join(root, "sample/docs/backlog/BL-1.md");
    for (const metadata of ['id: [BL-1]\ntitle: Test', 'id: BL-1\ntitle: !!js/function function() {}', 'id: BL-1\ntitle: Test\nlabels: [1]']) {
      await writeFile(path, `---\n${metadata}\n---\nBody`);
      expect((await call("backlog_list")).result.isError).toBe(true);
    }
  });

  it("reads the reference project's actual manifest and documentation", async () => {
    const root = new URL("../../../examples", import.meta.url).pathname;
    const backend = createProjectBackend({ root, projects: { "investimentos-api": "investimentos-api" } });
    const context = { ...ctx, project: { ...ctx.project, slug: "investimentos-api" }, allowedResources: { project: ["investimentos-api"] } };
    const result = await backend.callTool(context, "project_overview", {});
    expect(result.isError).not.toBe(true);
    const content = result.content[0];
    if (content.type !== "text") throw new Error("Expected text");
    const value = JSON.parse(content.text) as Record<string, unknown>;
    expect(value.id).toBe("investimentos");
    expect(value.manifest).toMatchObject({ name: "Investimentos API", stack: expect.arrayContaining(["Go 1.27"]), components: expect.arrayContaining([expect.objectContaining({ name: "api", path: "cmd/api" })]) });
    expect(value.sources).toEqual(["examples/investimentos-api/project.yaml", "examples/investimentos-api/README.md"]);
  });

  it("rejects malformed manifests and ungranted direct calls", async () => {
    const { root, backend, call } = await fixture();
    expect((await backend.callTool({ ...ctx, allowedResources: { project: [] } }, "project_overview", {})).isError).toBe(true);
    await writeFile(join(root, "sample/project.yaml"), "id: sample\nname: Sample\nsummary: Test\nstack: invalid\ncomponents: []\n");
    expect((await call("project_overview")).result.isError).toBe(true);
  });

  it("reduces oversized document metadata even with no body, preserving identity and continuation", async () => {
    const { root, call } = await fixture();
    for (const id of ["BL-1", "BL-2"]) {
      await writeFile(join(root, "sample/docs/backlog", `${id}.md`), `---\n${JSON.stringify({ id, title: "Large metadata", labels: Array.from({ length: 100 }, () => "a".repeat(200)), tags: Array.from({ length: 100 }, () => "b".repeat(200)) })}\n---\n`);
    }
    const single = await call("backlog_get", { id: "BL-1" });
    expect(single.result.isError).not.toBe(true);
    expect(single.value).toMatchObject({ id: "BL-1", title: "Large metadata", source: "examples/sample/docs/backlog/BL-1.md", truncated: true, metadataTruncated: true, metadata: { id: "BL-1", title: "Large metadata", metadataTruncated: true } });
    const first = await call("backlog_list");
    expect(first.result.isError).not.toBe(true);
    expect(first.value.items).toMatchObject([{ id: "BL-1", metadataTruncated: true }]);
    expect(typeof first.value.next_cursor).toBe("string");
    const second = await call("backlog_list", { cursor: first.value.next_cursor });
    expect(second.value.items).toMatchObject([{ id: "BL-2", metadataTruncated: true }]);
    expect(second.value.next_cursor).toBeNull();
  });

  it("reduces oversized manifest metadata while preserving manifest identity and both sources", async () => {
    const { root, call } = await fixture();
    await writeFile(join(root, "sample/project.yaml"), JSON.stringify({ id: "large", name: "Large manifest", summary: "s".repeat(2000), stack: Array.from({ length: 30 }, () => "s".repeat(200)), components: Array.from({ length: 30 }, () => ({ name: "name", path: "src", summary: "s".repeat(500) })) }));
    await writeFile(join(root, "sample/README.md"), "");
    const { result, value } = await call("project_overview");
    expect(result.isError).not.toBe(true);
    expect(value).toMatchObject({ id: "large", metadataTruncated: true, truncated: true, manifest: { id: "large", name: "Large manifest", source: "examples/sample/project.yaml", metadataTruncated: true } });
    expect(value.sources).toEqual(["examples/sample/project.yaml", "examples/sample/README.md"]);
  });
});
