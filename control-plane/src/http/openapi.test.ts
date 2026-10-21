// Keeps openapi.json and the server in sync: every documented operation exists, every
// /v1 route is documented, and real responses validate against the documented schemas.
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../db/database.ts";
import { login, marketplaceFixture, testServer } from "../test-support.ts";

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

  it("documents every /v1 route the server has", () => {
    const documented = new Set(Object.keys(spec.paths).map(toFastifyPath));
    const routes = app
      .printRoutes({ commonPrefix: false })
      .split("\n")
      .map((line) => /(\/v1\/\S*)/.exec(line)?.[1])
      .filter((route): route is string => route !== undefined);
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(documented.has(route), route).toBe(true);
    }
  });

  it.each([
    ["/v1/me", "/v1/me"],
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
