import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";

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


describe("public installer configuration", () => {
  it("defaults to the local origin and a coherent release version without implicit asset discovery", () => {
    expect(loadConfig(BASE)).toMatchObject({ publicApiUrl: "http://127.0.0.1:8080", installerVersion: "v0.2.2" });
    expect(loadConfig(BASE).installerAssetsDir).toBeUndefined();
    expect(loadConfig({ ...BASE, PUBLIC_API_URL: "http://127.0.0.1:18380/", INSTALLER_ASSETS_DIR: "/tmp/assets" }))
      .toMatchObject({ publicApiUrl: "http://127.0.0.1:18380", installerAssetsDir: "/tmp/assets" });
  });
  it.each(["javascript:alert(1)", "http://api.example", "https://user:secret@api.example", "https://api.example?q=x", "https://api.example#x", "https://api.example/\n"])("rejects unsafe public URL %s", (value) => {
    expect(() => loadConfig({ ...BASE, PUBLIC_API_URL: value })).toThrow("PUBLIC_API_URL");
  });
  it.each(["dev", "../secret", "v0.2.2;id"])("rejects invalid installer version %s", (value) => {
    expect(() => loadConfig({ ...BASE, INSTALLER_VERSION: value })).toThrow("INSTALLER_VERSION");
  });
});
