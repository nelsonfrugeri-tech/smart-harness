// Reads and validates the environment once at startup; a bad value stops the API.

export type AppEnv = "local" | "production";

export interface Config {
  appEnv: AppEnv;
  host: string;
  port: number;
  logLevel: string;
  databasePath: string;
  jwtSecret: Uint8Array;
  tokenTtlSeconds: number;
}

const APP_ENVS: readonly AppEnv[] = ["local", "production"];
const MIN_SECRET_LENGTH = 32;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const appEnv = env.APP_ENV ?? "production";
  if (!APP_ENVS.includes(appEnv as AppEnv)) {
    throw new Error(`APP_ENV must be one of ${APP_ENVS.join(", ")}, got "${appEnv}"`);
  }

  const secret = env.JWT_SECRET ?? "";
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters`);
  }

  return {
    appEnv: appEnv as AppEnv,
    host: env.HOST ?? "127.0.0.1",
    port: positiveInteger(env.PORT ?? "8080", "PORT"),
    logLevel: env.LOG_LEVEL ?? "info",
    databasePath: env.DATABASE_PATH ?? "data/control-plane.sqlite",
    jwtSecret: new TextEncoder().encode(secret),
    tokenTtlSeconds: positiveInteger(env.TOKEN_TTL_SECONDS ?? "3600", "TOKEN_TTL_SECONDS"),
  };
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got "${value}"`);
  }
  return parsed;
}
