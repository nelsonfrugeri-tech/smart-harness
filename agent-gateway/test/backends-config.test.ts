import { describe, expect, it } from "vitest";
import { configuredBackends } from "../src/backends/index.ts";
import { loadConfig } from "../src/config.ts";

describe("configured MCP backends", () => {
  it("always registers project context, without enabling services missing credentials", () => {
    expect(configuredBackends(loadConfig({})).map((backend) => backend.server)).toEqual(["project"]);
    expect(configuredBackends(loadConfig({ APP_ENV: "local" })).map((backend) => backend.server)).toEqual(["project", "echo"]);
  });

  it("registers services only when the corresponding credentials exist", () => {
    const config = loadConfig({ GITHUB_TOKEN: "github-secret", TRELLO_API_KEY: "trello-key", TRELLO_TOKEN: "trello-secret", NOTION_TOKEN: "notion-secret" });
    expect(configuredBackends(config).map((backend) => backend.server)).toEqual(["project", "github", "trello", "notion"]);
  });

  it("refuses partially configured Trello authentication without revealing credentials", () => {
    expect(() => loadConfig({ TRELLO_API_KEY: "do-not-print" })).toThrow("TRELLO_API_KEY and TRELLO_TOKEN must be configured together");
    expect(() => loadConfig({ TRELLO_TOKEN: "do-not-print" })).toThrow("TRELLO_API_KEY and TRELLO_TOKEN must be configured together");
  });
});
