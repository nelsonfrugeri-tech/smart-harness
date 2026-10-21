import type { Config } from "../config.ts";
import type { McpBackend } from "../mcp/backend.ts";
import { echoBackend } from "./echo.ts";
import { githubBackend } from "./github.ts";
import { notionBackend } from "./notion.ts";
import { projectBackend } from "./project.ts";
import { trelloBackend } from "./trello.ts";

// A real backend is registered only when its credentials (or folder) are configured; without them
// the server answers 404 like any unknown server. The echo test backend exists only with APP_ENV=local.
export function configuredBackends(config: Config): McpBackend[] {
  const backends: McpBackend[] = [];
  if (config.appEnv === "local") backends.push(echoBackend);
  if (config.githubToken !== undefined) {
    backends.push(githubBackend({ mcpUrl: config.githubMcpUrl, token: config.githubToken }));
  }
  if (config.trello !== undefined) {
    backends.push(trelloBackend({ apiUrl: config.trelloApiUrl, ...config.trello }));
  }
  if (config.notionToken !== undefined) {
    backends.push(notionBackend({ apiUrl: config.notionApiUrl, token: config.notionToken, version: config.notionVersion }));
  }
  if (config.projectContextRoot !== undefined) {
    backends.push(projectBackend({ root: config.projectContextRoot }));
  }
  return backends;
}
