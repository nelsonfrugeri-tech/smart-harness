import type { Config } from "../config.ts";
import type { McpBackend } from "../mcp/backend.ts";
import { echoBackend } from "./echo.ts";
import { createGithubBackend } from "./github/index.ts";
import { createNotionBackend } from "./notion/index.ts";
import { createProjectBackend } from "./project/index.ts";
import { createTrelloBackend } from "./trello/index.ts";

export function configuredBackends(config: Config): McpBackend[] {
  const backends: McpBackend[] = [createProjectBackend({
    root: config.projectContextRoot,
    projects: { "investimentos-api": "investimentos-api" },
  })];
  if (config.appEnv === "local") backends.push(echoBackend);
  if (config.githubToken !== "") backends.push(createGithubBackend({ token: config.githubToken }));
  if (config.trelloApiKey !== "") {
    backends.push(createTrelloBackend({ apiKey: config.trelloApiKey, token: config.trelloToken }));
  }
  if (config.notionToken !== "") backends.push(createNotionBackend({ token: config.notionToken }));
  return backends;
}
