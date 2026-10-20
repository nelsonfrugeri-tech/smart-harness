import { describe, expect, it } from "vitest";
import { buildServer } from "./server.ts";

describe("control-plane", () => {
  it("GET /healthz responde 200 com status ok", async () => {
    const app = buildServer();

    const response = await app.inject({ method: "GET", url: "/healthz" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("rota desconhecida responde 404", async () => {
    const app = buildServer();

    const response = await app.inject({ method: "GET", url: "/nao-existe" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ statusCode: 404, error: "Not Found" });
  });
});
