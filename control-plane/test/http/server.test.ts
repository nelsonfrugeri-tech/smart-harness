import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/database.ts";
import { seededDatabase, testServer } from "../test-support.ts";

describe("control-plane server", () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(() => {
    db = seededDatabase();
    app = testServer(db);
  });

  afterEach(async () => {
    await app.close();
    if (db.open) db.close();
  });

  it("GET /healthz responds 200 with status ok", async () => {
    const response = await app.inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("GET /readyz responds 200 while the database answers", async () => {
    const response = await app.inject({ method: "GET", url: "/readyz" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ready" });
  });

  it("GET /readyz responds 503 problem+json when the database is closed", async () => {
    db.close();

    const response = await app.inject({ method: "GET", url: "/readyz" });

    expect(response.statusCode).toBe(503);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toMatchObject({ status: 503, code: "not_ready" });
  });

  it("GET /metrics exposes Prometheus text with the route template as label", async () => {
    await app.inject({ method: "GET", url: "/healthz" });

    const response = await app.inject({ method: "GET", url: "/metrics" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toMatch(/http_request_duration_seconds_count\{method="GET",route="\/healthz",status_code="200"\} 1/);
    expect(response.body).toContain("process_cpu_user_seconds_total");
  });

  it("unknown route responds 404 problem+json with the correlation id", async () => {
    const response = await app.inject({ method: "GET", url: "/does-not-exist" });

    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    const body = response.json();
    expect(body).toMatchObject({ type: "about:blank", title: "Not Found", status: 404, code: "not_found" });
    expect(body.correlation_id).toBe(response.headers["x-correlation-id"]);
  });

  it("reuses a well-formed x-correlation-id and replaces a malformed one", async () => {
    const reused = await app.inject({ method: "GET", url: "/healthz", headers: { "x-correlation-id": "abc-123" } });
    const replaced = await app.inject({ method: "GET", url: "/healthz", headers: { "x-correlation-id": "bad id\n" } });

    expect(reused.headers["x-correlation-id"]).toBe("abc-123");
    expect(replaced.headers["x-correlation-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("malformed JSON responds 400 problem+json", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/dev-login",
      headers: { "content-type": "application/json" },
      payload: "{",
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toMatchObject({ status: 400, code: "bad_request" });
  });
});

describe("dev-login outside APP_ENV=local", () => {
  it("does not exist: the route answers 404", async () => {
    const db = seededDatabase();
    const app = testServer(db, "production");

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/dev-login",
      payload: { email: "dev@smart-harness.local" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: "not_found" });
    await app.close();
    db.close();
  });
});
