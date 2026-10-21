// Reads and validates the environment once at startup; a bad value stops the API.
import type { StorageConfig } from "./storage/packages.ts";

export type AppEnv = "local" | "production";

export interface Config {
  appEnv: AppEnv;
  host: string;
  port: number;
  logLevel: string;
  databasePath: string;
  jwtSecret: Uint8Array;
  tokenTtlSeconds: number;
  // Public URL of the Agent Gateway, sent in the setup-plan.
  gatewayPublicUrl: string;
  storage: StorageConfig;
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
    gatewayPublicUrl: httpUrl(env.GATEWAY_PUBLIC_URL ?? "http://127.0.0.1:8081", "GATEWAY_PUBLIC_URL"),
    storage: storageConfig(env),
  };
}

function storageConfig(env: NodeJS.ProcessEnv): StorageConfig {
  const accessKeyId = env.S3_ACCESS_KEY_ID || undefined;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY || undefined;
  if ((accessKeyId === undefined) !== (secretAccessKey === undefined)) {
    throw new Error("set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither");
  }
  const endpoint = env.S3_ENDPOINT || undefined;
  return {
    ...(endpoint === undefined ? {} : { endpoint: httpUrl(endpoint, "S3_ENDPOINT") }),
    region: env.S3_REGION || "us-east-1",
    bucket: env.S3_BUCKET || "packages",
    ...(accessKeyId === undefined ? {} : { accessKeyId, secretAccessKey }),
  };
}

function httpUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an http(s) URL, got "${value}"`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must be an http(s) URL, got "${value}"`);
  }
  return value.replace(/\/+$/, "");
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got "${value}"`);
  }
  return parsed;
}
