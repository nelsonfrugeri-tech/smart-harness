import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { projectBackend } from "../../src/backends/project.ts";
import { MAX_RESPONSE_CHARS } from "../../src/mcp/limits.ts";
import { connectClient, createFixture, DEV, type Fixture } from "../test-support.ts";

// The reference project, the same folder that compose mounts at /project-context.
const EXAMPLES = resolve(import.meta.dirname, "../../../examples");

// Tests read fields of the parsed result directly; the assertions check their shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function json(result: unknown): any {
  return JSON.parse((result as { content: { text: string }[] }).content[0]?.text ?? "null");
}

describe("project backend with the reference project", () => {
  let fixture: Fixture;
  let client: Client;

  beforeAll(async () => {
    fixture = await createFixture({ backends: [projectBackend({ root: EXAMPLES })] });
    client = await connectClient(fixture.mcpUrl("investimentos-api", "project"), fixture.token(DEV));
  });
  afterAll(async () => {
    await client.close();
    await fixture.close();
  });

  it("lists the five project tools", async () => {
    const names = (await client.listTools()).tools.map((tool) => tool.name).sort();

    expect(names).toEqual(["backlog_get", "backlog_list", "decisions_search", "delivered_list", "project_overview"]);
  });

  it("describes the project with its source and the number of documents", async () => {
    const overview = json(await client.callTool({ name: "project_overview", arguments: {} }));

    expect(overview).toMatchObject({
      id: "investimentos-api",
      source: "investimentos-api/project.yaml",
      name: "Investimentos API",
      counts: { decisions: 3, backlog: 5, delivered: 2 },
    });
    expect(overview.components.map((c: { name: string }) => c.name)).toContain("dynamo");
  });

  it("returns the ADRs with their source and finds one by its text", async () => {
    const all = json(await client.callTool({ name: "decisions_search", arguments: {} }));
    const found = json(await client.callTool({ name: "decisions_search", arguments: { query: "Scan" } }));

    expect(all.items.map((item: { id: string }) => item.id)).toEqual(["ADR-0001", "ADR-0002", "ADR-0003"]);
    expect(all.items[0]).toMatchObject({
      id: "ADR-0001",
      title: "Tabela única no DynamoDB, sem Scan",
      status: "accepted",
      source: "investimentos-api/docs/adr/ADR-0001-single-table-sem-scan.md",
    });
    expect(found.items.map((item: { id: string }) => item.id)).toContain("ADR-0001");
    expect(found.items[0].excerpt.toLowerCase()).toContain("scan");
  });

  it("lists the backlog, filters by status and reads one item with its acceptance criteria", async () => {
    const all = json(await client.callTool({ name: "backlog_list", arguments: {} }));
    const ready = json(await client.callTool({ name: "backlog_list", arguments: { status: "ready" } }));
    const item = json(await client.callTool({ name: "backlog_get", arguments: { id: "BL-102" } }));

    expect(all.items.map((i: { id: string }) => i.id)).toEqual(["BL-001", "BL-002", "BL-101", "BL-102", "BL-103"]);
    expect(ready.items.map((i: { id: string }) => i.id)).toContain("BL-102");
    expect(ready.items.every((i: { status: string }) => i.status === "ready")).toBe(true);
    expect(item).toMatchObject({ id: "BL-102", status: "ready", source: "investimentos-api/docs/backlog/BL-102-paginar-posicoes.md" });
    expect(item.body).toContain("Percorrer todas as páginas devolve cada posição uma única vez");
  });

  it("lists what was delivered, linked to the backlog", async () => {
    const delivered = json(await client.callTool({ name: "delivered_list", arguments: {} }));

    expect(delivered.items.map((i: { id: string; backlog_id: string }) => [i.id, i.backlog_id])).toEqual([
      ["DL-001", "BL-001"],
      ["DL-002", "BL-002"],
    ]);
  });

  it("answers an unknown or malformed backlog id with an error", async () => {
    for (const id of ["BL-999", "../../etc/passwd"]) {
      const result = await client.callTool({ name: "backlog_get", arguments: { id } });

      expect(result.isError).toBe(true);
    }
  });

  it("audits a project tool call with the project as the resource", async () => {
    await client.callTool({ name: "project_overview", arguments: {} });

    const details = JSON.parse(fixture.auditRows().at(-1)?.details ?? "{}");
    expect(details).toMatchObject({ server: "project", tool: "project_overview", outcome: "ok", resource_type: "project", resource_id: "investimentos-api" });
  });

  it("serves only the folder of the caller's own project", async () => {
    const web = await connectClient(fixture.mcpUrl("investimentos-web", "project"), fixture.token(DEV));

    const result = await web.callTool({ name: "project_overview", arguments: {} });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain("Investimentos API");
    await web.close();
  });
});

describe("project backend with large documents", () => {
  let root: string;
  let fixture: Fixture;
  let client: Client;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "project-context-"));
    const backlog = join(root, "investimentos-api", "docs", "backlog");
    mkdirSync(backlog, { recursive: true });
    writeFileSync(join(root, "investimentos-api", "project.yaml"), "name: Big\nsummary: s\n");
    for (let n = 1; n <= 80; n++) {
      const id = `BL-${String(n).padStart(3, "0")}`;
      writeFileSync(join(backlog, `${id}.md`), `---\nid: ${id}\ntitle: ${"Item ".repeat(40)}${n}\nstatus: ready\n---\n\nBody ${n}\n`);
    }
    const criteria = Array.from({ length: 500 }, (_, i) => `- [ ] criterion ${i} ${"c".repeat(60)}`).join("\n");
    writeFileSync(join(backlog, "BL-900.md"), `---\nid: BL-900\ntitle: Huge item\nstatus: ready\n---\n\n${criteria}\n`);
    fixture = await createFixture({ backends: [projectBackend({ root })] });
    client = await connectClient(fixture.mcpUrl("investimentos-api", "project"), fixture.token(DEV));
  });
  afterAll(async () => {
    await client.close();
    await fixture.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("returns an item above the limit as valid JSON with id and source", async () => {
    const result = await client.callTool({ name: "backlog_get", arguments: { id: "BL-900" } });

    const text = (result.content as { text: string }[])[0]?.text ?? "";
    expect(text.length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
    expect(JSON.parse(text)).toMatchObject({ id: "BL-900", source: "investimentos-api/docs/backlog/BL-900.md", title: "Huge item", truncated: true });
  });

  it("walks a long backlog page by page, each item exactly once", async () => {
    const ids: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const result = await client.callTool({ name: "backlog_list", arguments: cursor === undefined ? {} : { cursor } });
      expect((result.content as { text: string }[])[0]?.text.length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
      const page = json(result);
      ids.push(...page.items.map((item: { id: string }) => item.id));
      cursor = page.next_cursor;
      pages++;
    } while (cursor !== undefined && pages < 50);

    const expected = [...Array.from({ length: 80 }, (_, i) => `BL-${String(i + 1).padStart(3, "0")}`), "BL-900"];
    expect(pages).toBeGreaterThan(2);
    expect(ids).toEqual(expected);
  });
});
