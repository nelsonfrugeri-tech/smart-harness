// Shared test setup: an in-memory database with the real migrations and the local seed,
// and an in-memory S3 behind the real package storage.
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { FastifyInstance } from "fastify";
import type { HarnessClient, ValidationReport } from "../src/domain/publish.ts";
import { seedLocalData } from "../seed/local-data.ts";
import { seedDemoData } from "../seed/demo-data.ts";
import { seedMarketplace } from "../seed/marketplace.ts";
import type { AppEnv } from "../src/config.ts";
import { openDatabase, type Db } from "../src/db/database.ts";
import { runMigrations } from "../src/db/migrate.ts";
import { buildServer } from "../src/http/server.ts";
import { createPackageStorage, type PackageStorage, type S3Sender } from "../src/storage/packages.ts";

export const TEST_SECRET = new TextEncoder().encode("test-secret-with-at-least-32-characters");

export function seededDatabase(): Db {
  const db = openDatabase(":memory:");
  runMigrations(db);
  seedLocalData(db);
  return db;
}

export const TEST_BUCKET = "packages";
export const TEST_GATEWAY_URL = "http://127.0.0.1:8081";

export const TEST_GATEWAY_TOKEN_TTL_DAYS = 90;

// A stand-in for the harness binary. validate reads plugin.json and reports invalid when a file
// contains INVALID; pack writes a deterministic archive made of the sorted files. Every call is
// recorded, so a test can assert that a route did not run the binary.
export class FakeHarness implements HarnessClient {
  readonly calls: string[] = [];
  // Runs inside validate, before it answers; lets a test change the draft meanwhile.
  onValidate: (() => Promise<void>) | undefined;

  async validate(dir: string): Promise<ValidationReport> {
    this.calls.push("validate");
    await this.onValidate?.();
    const files = await readTree(dir);
    const plugin = JSON.parse(files.get("plugin.json") ?? "{}") as { name?: string; version?: string };
    const invalid = [...files.entries()].find(([, content]) => content.includes("INVALID"));
    return {
      valid: invalid === undefined,
      findings: invalid
        ? [{ code: "SH-TEST-001", severity: "error", message: "file is invalid", hint: "remove INVALID", path: invalid[0], line: 1 }]
        : [],
      plugin: plugin.name ?? "",
      version: plugin.version ?? "",
      components: [{ kind: "skill", name: "demo-skill", description: "From the report." }],
    };
  }

  async generate(dir: string): Promise<void> {
    this.calls.push("generate");
    await writeFile(join(dir, "GENERATED.md"), "generated layer\n");
  }

  async pack(dir: string, outFile: string): Promise<{ digest: string }> {
    this.calls.push("pack");
    const files = await readTree(dir);
    const bytes = Buffer.from(JSON.stringify([...files.entries()].sort(([a], [b]) => a.localeCompare(b))));
    await writeFile(outFile, bytes);
    return { digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
  }
}

async function readTree(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files.set(relative(root, path), await readFile(path, "utf8"));
  }
  return files;
}

export function testServer(
  db: Db,
  appEnv: AppEnv = "local",
  storage: PackageStorage = createPackageStorage(new FakeS3([TEST_BUCKET]), TEST_BUCKET),
  logStream?: { write(line: string): void },
  harness: HarnessClient = new FakeHarness(),
): FastifyInstance {
  return buildServer({
    db,
    storage,
    harness,
    config: {
      appEnv,
      jwtSecret: TEST_SECRET,
      tokenTtlSeconds: 3600,
      gatewayTokenTtlDays: TEST_GATEWAY_TOKEN_TTL_DAYS,
      logLevel: logStream === undefined ? "silent" : "trace",
      gatewayPublicUrl: TEST_GATEWAY_URL,
    },
    ...(logStream === undefined ? {} : { logger: true, logStream }),
  });
}

// Seeded database plus the sample Marketplace, stored in an in-memory S3.
export async function marketplaceFixture(): Promise<{ db: Db; s3: FakeS3; storage: PackageStorage }> {
  const db = seededDatabase();
  const s3 = new FakeS3([TEST_BUCKET]);
  const storage = createPackageStorage(s3, TEST_BUCKET);
  seedDemoData(db);
  await seedMarketplace({ db, storage });
  return { db, s3, storage };
}

function notFoundError(): Error {
  return Object.assign(new Error("not found"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
}

// Answers the five S3 commands the storage sends, like S3 or MinIO would.
export class FakeS3 implements S3Sender {
  readonly buckets: Set<string>;
  readonly objects = new Map<string, Uint8Array>();
  readonly sent: string[] = [];

  constructor(buckets: string[] = []) {
    this.buckets = new Set(buckets);
  }

  keys(bucket: string): string[] {
    return [...this.objects.keys()].filter((key) => key.startsWith(`${bucket}/`)).map((key) => key.slice(bucket.length + 1));
  }

  send = (async (command: { input: { Bucket?: string; Key?: string; Body?: unknown } }) => {
    const { Bucket = "", Key = "", Body } = command.input;
    this.sent.push(command.constructor.name);
    if (command instanceof HeadBucketCommand) {
      if (!this.buckets.has(Bucket)) throw notFoundError();
      return {};
    }
    if (command instanceof CreateBucketCommand) {
      this.buckets.add(Bucket);
      return {};
    }
    if (!this.buckets.has(Bucket)) throw Object.assign(new Error("no bucket"), { name: "NoSuchBucket" });
    const path = `${Bucket}/${Key}`;
    if (command instanceof HeadObjectCommand) {
      if (!this.objects.has(path)) throw notFoundError();
      return {};
    }
    if (command instanceof PutObjectCommand) {
      this.objects.set(path, new Uint8Array(Body as Uint8Array));
      return {};
    }
    if (command instanceof GetObjectCommand) {
      const bytes = this.objects.get(path);
      if (!bytes) throw Object.assign(new Error("no key"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
      return { Body: { transformToByteArray: async () => new Uint8Array(bytes) } };
    }
    throw new Error(`FakeS3 does not support ${command.constructor.name}`);
  }) as unknown as S3Sender["send"];
}

export interface RegisteredRoute {
  method: string;
  url: string;
}

// Every method and URL the server registered, read from the printRoutes() tree.
// Child lines hold only the suffix of their parent's path, so the parent path is carried down.
export function registeredRoutes(app: FastifyInstance): RegisteredRoute[] {
  const routes: RegisteredRoute[] = [];
  const pathAtDepth: string[] = [];
  for (const line of app.printRoutes({ commonPrefix: false }).split("\n")) {
    const match = /^((?:│ {3}| {4})*)[├└]── (\S+)(?: \(([^)]+)\))?$/.exec(line);
    if (!match) continue;
    const depth = match[1].length / 4;
    const url = (depth === 0 ? "" : pathAtDepth[depth - 1]) + match[2];
    pathAtDepth[depth] = url;
    for (const method of match[3]?.split(", ") ?? []) routes.push({ method, url });
  }
  return routes;
}

export async function login(app: FastifyInstance, email: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/v1/auth/dev-login", payload: { email } });
  if (response.statusCode !== 200) {
    throw new Error(`dev-login for ${email} answered ${response.statusCode}: ${response.body}`);
  }
  return response.json<{ access_token: string }>().access_token;
}

export function tenantId(db: Db, slug: string): string {
  return (db.prepare("SELECT id FROM tenants WHERE slug = ?").get(slug) as { id: string }).id;
}

export function userId(db: Db, email: string): string {
  return (db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string }).id;
}
