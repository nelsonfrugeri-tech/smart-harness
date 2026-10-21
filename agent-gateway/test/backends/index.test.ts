import { describe, expect, it } from "vitest";
import { configuredBackends } from "../../src/backends/index.ts";
import { loadConfig } from "../../src/config.ts";

const names = (env: NodeJS.ProcessEnv) => configuredBackends(loadConfig(env)).map((backend) => backend.server);

describe("configuredBackends", () => {
  it("registers no backend in production without credentials", () => {
    expect(names({ APP_ENV: "production" })).toEqual([]);
  });

  it("treats empty variables, as compose passes them, like unset ones", () => {
    expect(names({ GITHUB_TOKEN: "", TRELLO_API_KEY: "", TRELLO_TOKEN: "", NOTION_TOKEN: " ", PROJECT_CONTEXT_ROOT: "" })).toEqual([]);
  });

  it("registers each backend whose credentials are set, and echo only locally", () => {
    const env = { GITHUB_TOKEN: "g", TRELLO_API_KEY: "k", TRELLO_TOKEN: "t", NOTION_TOKEN: "n", PROJECT_CONTEXT_ROOT: "/project-context" };

    expect(names(env)).toEqual(["github", "trello", "notion", "project"]);
    expect(names({ ...env, APP_ENV: "local" })).toEqual(["echo", "github", "trello", "notion", "project"]);
  });

  it("refuses a Trello key without its token, and the other way around", () => {
    expect(() => loadConfig({ TRELLO_API_KEY: "k" })).toThrow(/TRELLO_API_KEY and TRELLO_TOKEN/);
    expect(() => loadConfig({ TRELLO_TOKEN: "t" })).toThrow(/TRELLO_API_KEY and TRELLO_TOKEN/);
  });

  it("uses the official endpoints and the current Notion version by default", () => {
    const config = loadConfig({});

    expect(config.githubMcpUrl).toBe("https://api.githubcopilot.com/mcp/");
    expect(config.trelloApiUrl).toBe("https://api.trello.com/1");
    expect(config.notionApiUrl).toBe("https://api.notion.com/v1");
    expect(config.notionVersion).toBe("2026-03-11");
  });
});
