import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { configuredBackends } from "../src/backends/index.ts";
import { loadConfig } from "../src/config.ts";
import { connectClient, createFixture, DEV } from "./test-support.ts";

describe("project context through the authenticated MCP endpoint", () => {
  it("reads real project documents and denies another project in the same squad", async () => {
    const config = loadConfig({ PROJECT_CONTEXT_ROOT: fileURLToPath(new URL("../../examples/", import.meta.url)) });
    const fixture = await createFixture({ backends: configuredBackends(config) });
    const client = await connectClient(fixture.mcpUrl("investimentos-api", "project"), fixture.token(DEV));
    const other = await connectClient(fixture.mcpUrl("investimentos-web", "project"), fixture.token(DEV));
    try {
      expect((await client.listTools()).tools).toHaveLength(5);
      const overview = await client.callTool({ name: "project_overview", arguments: {} });
      expect(overview.isError).not.toBe(true);
      expect(JSON.stringify(overview)).toContain("examples/investimentos-api/project.yaml");
      expect(JSON.stringify(overview)).toContain("Investimentos API");
      const decisions = await client.callTool({ name: "decisions_search", arguments: { query: "DynamoDB" } });
      expect(decisions.isError).not.toBe(true);
      expect(JSON.stringify(decisions)).toContain("ADR-0001");
      const backlog = await client.callTool({ name: "backlog_get", arguments: { id: "BL-101" } });
      expect(backlog.isError).not.toBe(true);
      expect(JSON.stringify(backlog)).toContain("BL-101-cancelar-ordem.md");
      const denied = await other.callTool({ name: "project_overview", arguments: {} });
      expect(denied.isError).toBe(true);
      expect(JSON.stringify(denied)).not.toContain("README.md");
      expect(fixture.auditRows().map((row) => JSON.parse(row.details).outcome)).toEqual(["ok", "ok", "ok", "denied"]);
    } finally {
      await Promise.all([client.close(), other.close()]);
      await fixture.close();
    }
  });
});
