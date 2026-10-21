// Reads and validates the environment once at startup; a bad value stops the gateway.

export type AppEnv = "local" | "production";

export interface Config {
  appEnv: AppEnv;
  host: string;
  port: number;
  logLevel: string;
  // The SQLite file owned by the control plane; the gateway reads it and appends audit events.
  databasePath: string;
  // Browser origins allowed to call the gateway. Requests without an Origin header are not affected.
  allowedOrigins: readonly string[];
  // Service credentials of the upstream systems. They live only in this process: they are never
  // sent to the developer, logged or audited. A backend whose credentials are unset is not registered.
  githubToken: string | undefined;
  githubMcpUrl: string;
  trello: { apiKey: string; token: string } | undefined;
  trelloApiUrl: string;
  notionToken: string | undefined;
  notionApiUrl: string;
  notionVersion: string;
  // Directory with one folder per project slug (for example investimentos-api/docs/adr).
  projectContextRoot: string | undefined;
}

const APP_ENVS: readonly AppEnv[] = ["local", "production"];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const appEnv = env.APP_ENV ?? "production";
  if (!APP_ENVS.includes(appEnv as AppEnv)) {
    throw new Error(`APP_ENV must be one of ${APP_ENVS.join(", ")}, got "${appEnv}"`);
  }
  return {
    appEnv: appEnv as AppEnv,
    host: env.HOST ?? "127.0.0.1",
    port: positiveInteger(env.PORT ?? "8081", "PORT"),
    logLevel: env.LOG_LEVEL ?? "info",
    databasePath: env.DATABASE_PATH ?? "data/control-plane.sqlite",
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin !== ""),
    githubToken: optional(env.GITHUB_TOKEN),
    githubMcpUrl: env.GITHUB_MCP_URL ?? "https://api.githubcopilot.com/mcp/",
    trello: trelloCredentials(env),
    trelloApiUrl: env.TRELLO_API_URL ?? "https://api.trello.com/1",
    notionToken: optional(env.NOTION_TOKEN),
    notionApiUrl: env.NOTION_API_URL ?? "https://api.notion.com/v1",
    notionVersion: env.NOTION_VERSION ?? "2026-03-11",
    projectContextRoot: optional(env.PROJECT_CONTEXT_ROOT),
  };
}

// Compose passes unset variables as empty strings, so empty means unset.
function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

function trelloCredentials(env: NodeJS.ProcessEnv): Config["trello"] {
  const apiKey = optional(env.TRELLO_API_KEY);
  const token = optional(env.TRELLO_TOKEN);
  if (apiKey === undefined && token === undefined) return undefined;
  if (apiKey === undefined || token === undefined) {
    throw new Error("TRELLO_API_KEY and TRELLO_TOKEN must be set together");
  }
  return { apiKey, token };
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got "${value}"`);
  }
  return parsed;
}
