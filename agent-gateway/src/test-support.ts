// Shared test setup. The database is a real SQLite file built with the control plane's own
// migrations and seed, so the gateway is tested against the schema the API owns.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { seedLocalData } from "../../control-plane/seed/local-data.ts";
import { openDatabase as openApiDatabase, type Db as ApiDb } from "../../control-plane/src/db/database.ts";
import { insertGatewayToken, revokeGatewayToken } from "../../control-plane/src/db/repos/gateway-tokens.ts";
import { runMigrations } from "../../control-plane/src/db/migrate.ts";
import { generateGatewayToken } from "../../control-plane/src/domain/gateway-token.ts";
import { echoBackend } from "./backends/echo.ts";
import { createAuditSink } from "./db/audit.ts";
import { openAuditDatabase, openReadDatabase, type Db } from "./db/database.ts";
import { createRegistry, type McpBackend } from "./mcp/backend.ts";
import { buildServer } from "./server.ts";

export interface Fixture {
  app: FastifyInstance;
  // The connection of the control plane (the other writer of the file).
  apiDb: ApiDb;
  readDb: Db;
  path: string;
  baseUrl: string;
  mcpUrl(project: string, server: string): string;
  // Creates a gateway token for the seeded user, exactly as the API does.
  token(email: string): string;
  revokeAll(email: string): void;
  auditRows(): { action: string; actor_user_id: string; tenant_id: string | null; details: string }[];
  close(): Promise<void>;
}

export interface FixtureOptions {
  backends?: McpBackend[];
  allowedOrigins?: string[];
  logStream?: { write(line: string): void };
}

export async function createFixture(options: FixtureOptions = {}): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), "gateway-test-"));
  const path = join(dir, "control-plane.sqlite");
  const apiDb = openApiDatabase(path);
  runMigrations(apiDb);
  seedLocalData(apiDb);
  addSecondInvestimentosProject(apiDb);

  const readDb = openReadDatabase(path);
  const auditDb = openAuditDatabase(path);
  const app = buildServer({
    readDb,
    auditDb,
    audit: createAuditSink(auditDb),
    backends: createRegistry(options.backends ?? [echoBackend]),
    config: { logLevel: "trace", allowedOrigins: options.allowedOrigins ?? [] },
    ...(options.logStream === undefined ? {} : { logger: true, logStream: options.logStream }),
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  const baseUrl = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`;

  const userId = (email: string) =>
    (apiDb.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string }).id;

  return {
    app,
    apiDb,
    readDb,
    path,
    baseUrl,
    mcpUrl: (project, server) => `${baseUrl}/mcp/projects/${project}/${server}`,
    token(email) {
      const { token, hash } = generateGatewayToken();
      insertGatewayToken(apiDb, { userId: userId(email), name: "test", tokenHash: hash, ttlDays: 90 });
      return token;
    },
    revokeAll(email) {
      const ids = apiDb.prepare("SELECT id FROM gateway_tokens WHERE user_id = ?").all(userId(email)) as { id: string }[];
      for (const { id } of ids) revokeGatewayToken(apiDb, userId(email), id);
    },
    auditRows: () =>
      apiDb.prepare("SELECT action, actor_user_id, tenant_id, details FROM audit_events ORDER BY id").all() as ReturnType<
        Fixture["auditRows"]
      >,
    async close() {
      await app.close();
      readDb.close();
      auditDb.close();
      apiDb.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// investimentos-web: another project of the same squad as investimentos-api, with its own resources.
function addSecondInvestimentosProject(db: ApiDb): void {
  const tenant = db.prepare("SELECT id FROM tenants WHERE slug = 'investimentos'").get() as { id: string };
  db.prepare("INSERT INTO projects (id, tenant_id, slug, name) VALUES ('project-web', ?, 'investimentos-web', 'Web')").run(
    tenant.id,
  );
  const grant = db.prepare(
    "INSERT INTO gateway_permissions (project_id, server, resource_type, resource_id) VALUES ('project-web', ?, ?, ?)",
  );
  grant.run("github", "repo", "acme-fake/investimentos-web");
  grant.run("echo", "item", "web-item");
}

// A backend that counts the calls it receives, to prove that a denied call never reaches it.
export interface CountingBackend extends McpBackend {
  calls: { name: string; args: Record<string, unknown> }[];
}

export function countingBackend(server = "github"): CountingBackend {
  const calls: CountingBackend["calls"] = [];
  return {
    server,
    calls,
    listTools: () => [
      {
        name: "get_repo",
        description: "Reads a repository.",
        inputSchema: { type: "object", properties: { repo: { type: "string" } } },
        access: { kind: "resource", resourceType: "repo", extract: (args) => (typeof args.repo === "string" ? args.repo : null) },
      },
      {
        name: "search_code",
        description: "Searches the allowed repositories.",
        inputSchema: { type: "object", properties: { query: { type: "string" } } },
        access: { kind: "search", resourceType: "repo" },
      },
      {
        name: "undeclared_tool",
        description: "Declares no resource.",
        inputSchema: { type: "object" },
      },
      {
        name: "broken_tool",
        description: "Always fails.",
        inputSchema: { type: "object", properties: { repo: { type: "string" } } },
        access: { kind: "resource", resourceType: "repo", extract: (args) => (typeof args.repo === "string" ? args.repo : null) },
      },
    ],
    async callTool(ctx, name, args) {
      calls.push({ name, args });
      if (name === "broken_tool") throw new Error(`failed for ${String(args.repo)} with secret-in-error`);
      if (name === "search_code") {
        return { content: [{ type: "text", text: JSON.stringify({ searched: ctx.allowedResources.repo ?? [] }) }] };
      }
      return { content: [{ type: "text", text: `repo ${String(args.repo)}` }] };
    },
  };
}

// A real MCP client from the official SDK, authenticated with a gateway token.
export async function connectClient(url: string, token: string): Promise<Client> {
  const client = new Client({ name: "gateway-test", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

export const DEV = "dev@smart-harness.local";
export const DEV_CARTOES = "dev.cartoes@smart-harness.local";
