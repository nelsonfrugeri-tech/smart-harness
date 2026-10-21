import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFixture, type Fixture } from "./test-support.ts";

describe("agent-gateway operations endpoints", () => {
  let fixture: Fixture;
  beforeAll(async () => {
    fixture = await createFixture();
  });
  afterAll(async () => fixture.close());

  it("GET /healthz responds 200 with status ok", async () => {
    const response = await fixture.app.inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("GET /readyz responds 200 when both database connections answer", async () => {
    const response = await fixture.app.inject({ method: "GET", url: "/readyz" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ready" });
  });

  it("GET /metrics exposes request duration and tool call counters", async () => {
    const response = await fixture.app.inject({ method: "GET", url: "/metrics" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("http_request_duration_seconds");
    expect(response.body).toContain("process_cpu_user_seconds_total");
  });

  it("unknown route responds 404", async () => {
    const response = await fixture.app.inject({ method: "GET", url: "/does-not-exist" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ statusCode: 404, error: "Not Found" });
  });

  it("returns the caller's correlation id and creates one when it is missing or malformed", async () => {
    const kept = await fixture.app.inject({ method: "GET", url: "/healthz", headers: { "x-correlation-id": "abc-123" } });
    const created = await fixture.app.inject({ method: "GET", url: "/healthz", headers: { "x-correlation-id": "bad id!" } });

    expect(kept.headers["x-correlation-id"]).toBe("abc-123");
    expect(created.headers["x-correlation-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("GET /readyz responds 503 when the read connection is closed", async () => {
    const broken = await createFixture();
    broken.readDb.close();

    const response = await broken.app.inject({ method: "GET", url: "/readyz" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: "not_ready" });
    await broken.close();
  });
});
