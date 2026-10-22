// Keeps openapi.json and the server in sync: every documented operation exists, every
// /v1 route is documented, and real responses validate against the documented schemas.
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/database.ts";
import { login, marketplaceFixture, registeredRoutes, testServer } from "../test-support.ts";

interface ResponseObject {
  $ref?: string;
  content?: Record<string, { schema?: object }>;
}

const spec = JSON.parse(readFileSync(new URL("../../openapi.json", import.meta.url), "utf8")) as {
  paths: Record<string, Record<string, { responses: Record<string, ResponseObject> }>>;
  components: { responses: Record<string, ResponseObject> };
};

// {name} in OpenAPI is :name in Fastify.
const toFastifyPath = (path: string) => path.replace(/\{(\w+)\}/g, ":$1");
const escapePointer = (segment: string) => segment.replace(/~/g, "~0").replace(/\//g, "~1");

const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
ajv.addSchema(spec, "openapi");

// Validates a body against the schema documented for this operation and status.
function validate(path: string, method: string, status: number, body: unknown): string[] {
  let pointer = `openapi#/paths/${escapePointer(path)}/${method}/responses/${status}`;
  let response = spec.paths[path][method].responses[String(status)];
  if (response?.$ref) {
    pointer = `openapi${response.$ref}`;
    response = spec.components.responses[response.$ref.split("/").pop() ?? ""];
  }
  const mediaType = Object.keys(response?.content ?? {})[0];
  if (mediaType === undefined) return [`${method} ${path} documents no body for ${status}`];
  const check = ajv.getSchema(`${pointer}/content/${escapePointer(mediaType)}/schema`);
  if (!check) return [`no schema at ${pointer}`];
  return check(body) ? [] : (check.errors ?? []).map((error) => `${error.instancePath} ${error.message}`);
}

describe("openapi.json", () => {
  let db: Db;
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    const fixture = await marketplaceFixture();
    db = fixture.db;
    app = testServer(db, "local", fixture.storage);
    await app.ready();
    token = await login(app, "dev@smart-harness.local");
  });

  afterAll(async () => {
    await app.close();
    db.close();
  });

  it("documents only routes the server has", () => {
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const method of Object.keys(methods)) {
        expect(app.hasRoute({ method: method.toUpperCase(), url: toFastifyPath(path) }), `${method} ${path}`).toBe(true);
      }
    }
  });

  it("documents every /v1 route and method the server has", () => {
    const documented = new Set(
      Object.entries(spec.paths).flatMap(([path, methods]) =>
        Object.keys(methods).map((method) => `${method.toUpperCase()} ${toFastifyPath(path)}`),
      ),
    );
    const routes = registeredRoutes(app).filter((route) => route.url.startsWith("/v1/") && route.method !== "HEAD");
    expect(routes.length).toBeGreaterThan(0);
    for (const { method, url } of routes) {
      expect(documented.has(`${method} ${url}`), `${method} ${url}`).toBe(true);
    }
  });

  it.each([
    ["/v1/me", "/v1/me"],
    ["/v1/me/setup-plan", "/v1/me/setup-plan?limit=2"],
    ["/v1/workspace", "/v1/workspace"],
    ["/v1/marketplace", "/v1/marketplace?limit=2"],
    ["/v1/plugins/{name}", "/v1/plugins/investimentos-base"],
    ["/v1/plugins/{name}/versions", "/v1/plugins/investimentos-base/versions"],
    ["/v1/projects/{slug}/setup-plan", "/v1/projects/investimentos-api/setup-plan"],
  ])("GET %s answers 200 with the documented shape", async (path, url) => {
    const response = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });

    expect(response.statusCode).toBe(200);
    expect(validate(path, "get", 200, response.json())).toEqual([]);
  });

  it("gateway token creation and listing answer the documented shapes", async () => {
    const headers = { authorization: `Bearer ${token}` };
    const created = await app.inject({ method: "POST", url: "/v1/me/gateway-tokens", headers, payload: { name: "contract" } });
    expect(created.statusCode).toBe(201);
    expect(validate("/v1/me/gateway-tokens", "post", 201, created.json())).toEqual([]);

    const list = await app.inject({ method: "GET", url: "/v1/me/gateway-tokens", headers });
    expect(list.statusCode).toBe(200);
    expect(validate("/v1/me/gateway-tokens", "get", 200, list.json())).toEqual([]);

    const denied = await app.inject({
      method: "GET",
      url: "/v1/me/gateway-tokens",
      headers: { authorization: `Bearer ${created.json().token}` },
    });
    expect(denied.statusCode).toBe(401);
    expect(validate("/v1/me/gateway-tokens", "get", 401, denied.json())).toEqual([]);
  });

  it("the contribution flow answers the documented shapes", async () => {
    const headers = { authorization: `Bearer ${token}` };
    const files = [
      { path: "plugin.json", content: JSON.stringify({ name: "contract-demo", version: "1.0.0", description: "Contract." }) },
      { path: "skills/demo-skill/SKILL.md", content: "body" },
    ];
    const created = await app.inject({ method: "POST", url: "/v1/drafts", headers, payload: { tenant: "investimentos", files } });
    expect(created.statusCode).toBe(201);
    expect(validate("/v1/drafts", "post", 201, created.json())).toEqual([]);
    const id = created.json().id;

    const badPath = await app.inject({
      method: "POST",
      url: "/v1/drafts",
      headers,
      payload: { tenant: "investimentos", files: [{ path: "../x", content: "x" }] },
    });
    expect(validate("/v1/drafts", "post", 400, badPath.json())).toEqual([]);

    const list = await app.inject({ method: "GET", url: "/v1/drafts", headers });
    expect(validate("/v1/drafts", "get", 200, list.json())).toEqual([]);

    const noIfMatch = await app.inject({ method: "PATCH", url: `/v1/drafts/${id}`, headers, payload: { visibility: "squad" } });
    expect(validate("/v1/drafts/{id}", "patch", 428, noIfMatch.json())).toEqual([]);
    const patched = await app.inject({
      method: "PATCH",
      url: `/v1/drafts/${id}`,
      headers: { ...headers, "if-match": '"1"' },
      payload: { visibility: "squad" },
    });
    expect(validate("/v1/drafts/{id}", "patch", 200, patched.json())).toEqual([]);

    const validated = await app.inject({ method: "POST", url: `/v1/drafts/${id}/validate`, headers });
    expect(validate("/v1/drafts/{id}/validate", "post", 200, validated.json())).toEqual([]);
    const read = await app.inject({ method: "GET", url: `/v1/drafts/${id}`, headers });
    expect(validate("/v1/drafts/{id}", "get", 200, read.json())).toEqual([]);

    const submitted = await app.inject({ method: "POST", url: `/v1/drafts/${id}/submit`, headers });
    expect(validate("/v1/drafts/{id}/submit", "post", 201, submitted.json())).toEqual([]);
    const open = await app.inject({ method: "POST", url: `/v1/drafts/${id}/submit`, headers });
    expect(validate("/v1/drafts/{id}/submit", "post", 409, open.json())).toEqual([]);

    const admin = { authorization: `Bearer ${await login(app, "admin@smart-harness.local")}` };
    const queue = await app.inject({ method: "GET", url: "/v1/contributions?view=review", headers: admin });
    expect(validate("/v1/contributions", "get", 200, queue.json())).toEqual([]);
    const contributionId = submitted.json().id;
    const approved = await app.inject({
      method: "POST",
      url: `/v1/contributions/${contributionId}/approve`,
      headers: admin,
      payload: { digest: validated.json().digest },
    });
    expect(approved.statusCode).toBe(200);
    expect(validate("/v1/contributions/{id}/approve", "post", 200, approved.json())).toEqual([]);
    const contribution = await app.inject({ method: "GET", url: `/v1/contributions/${contributionId}`, headers });
    expect(validate("/v1/contributions/{id}", "get", 200, contribution.json())).toEqual([]);

    const pinned = await app.inject({
      method: "PUT",
      url: "/v1/projects/investimentos-api/baseline/investimentos-base",
      headers: admin,
      payload: { version: "1.1.0" },
    });
    expect(validate("/v1/projects/{slug}/baseline/{plugin}", "put", 200, pinned.json())).toEqual([]);
  });

  it("a 404 problem has the documented shape", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/plugins/cartoes-base",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
    expect(validate("/v1/plugins/{name}", "get", 404, response.json())).toEqual([]);
  });
});
