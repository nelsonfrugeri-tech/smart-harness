import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";

const BASE = { JWT_SECRET: "x".repeat(32) };

describe("GATEWAY_TOKEN_TTL_DAYS", () => {
  it("defaults to 90 days", () => {
    expect(loadConfig(BASE).gatewayTokenTtlDays).toBe(90);
  });

  it("accepts a positive integer", () => {
    expect(loadConfig({ ...BASE, GATEWAY_TOKEN_TTL_DAYS: "7" }).gatewayTokenTtlDays).toBe(7);
  });

  it.each(["0", "-1", "1.5", "ninety"])("refuses %s", (value) => {
    expect(() => loadConfig({ ...BASE, GATEWAY_TOKEN_TTL_DAYS: value })).toThrow(/GATEWAY_TOKEN_TTL_DAYS must be a positive integer/);
  });
});
