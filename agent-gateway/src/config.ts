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
  };
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got "${value}"`);
  }
  return parsed;
}
