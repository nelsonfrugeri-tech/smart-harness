import { describe, expect, it } from "vitest";
import { buildServer } from "./server.ts";

describe("control-plane", () => {
  it("GET /healthz responds 200 with status ok", async () => {
    const app = buildServer();

    const response = await app.inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("unknown route responds 404", async () => {
    const app = buildServer();

    const response = await app.inject({ method: "GET", url: "/does-not-exist" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ statusCode: 404, error: "Not Found" });
  });
});
