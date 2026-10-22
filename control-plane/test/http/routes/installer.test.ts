import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../../src/config.ts";
import { buildServer } from "../../../src/http/server.ts";
import { createPackageStorage } from "../../../src/storage/packages.ts";
import { FakeHarness, FakeS3, seededDatabase, TEST_BUCKET } from "../../test-support.ts";

const VERSION = "v0.2.3";
const FILENAMES = ["darwin-arm64", "darwin-amd64", "linux-arm64", "linux-amd64"].map((platform) => `harness-${VERSION}-${platform}`);

describe("public installer and curated assets", () => {
  let dir: string;
  let app: FastifyInstance;
  const dbs: ReturnType<typeof seededDatabase>[] = [];
  function server(env: NodeJS.ProcessEnv = {}) {
    const db = seededDatabase(); dbs.push(db);
    return buildServer({ db, harness: new FakeHarness(), storage: createPackageStorage(new FakeS3([TEST_BUCKET]), TEST_BUCKET),
      config: loadConfig({ JWT_SECRET: "installer-test-secret-0000000000000000", INSTALLER_ASSETS_DIR: dir, ...env }) });
  }
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "installer-routes-"));
    await writeFile(join(dir, "install.sh"), "#!/bin/sh\nprintf '%s\\n' @@API_URL_SHELL@@ @@VERSION_SHELL@@\n");
    for (const file of [...FILENAMES, "SHA256SUMS"]) await writeFile(join(dir, file), `fixture:${file}`);
    app = server();
  });
  afterEach(async () => { await app.close(); for (const db of dbs.splice(0)) db.close(); await rm(dir, { recursive: true, force: true }); });

  it("serves the script without authentication using configured origin, not Host or forwarded headers", async () => {
    const response = await app.inject({ url: "/install", headers: { host: "attacker.example", "x-forwarded-host": "other.example", "x-forwarded-proto": "https" } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/x-shellscript");
    expect(response.body).not.toContain("@@");
    expect(execFileSync("sh", ["-c", response.body], { encoding: "utf8" })).toBe("http://127.0.0.1:8080\nv0.2.3\n");
  });

  it("quotes the configured URL as one literal shell value", async () => {
    await app.close();
    const url = "https://api.example/a'$(id)";
    app = server({ PUBLIC_API_URL: url });
    const response = await app.inject({ url: "/install" });
    expect(response.statusCode).toBe(200);
    expect(execFileSync("sh", ["-c", response.body], { encoding: "utf8" })).toBe(`${url}\n${VERSION}\n`);
  });

  it("serves exactly four binaries and checksums without exposing other files", async () => {
    for (const file of [...FILENAMES, "SHA256SUMS"]) {
      const response = await app.inject({ url: `/install/${file}` });
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(`fixture:${file}`);
    }
    await writeFile(join(dir, "private.txt"), "private-value");
    for (const path of ["private.txt", "install.sh", "harness-v0.1.0-linux-amd64", "harness-v0.2.3-windows-amd64", "%2e%2e%2fprivate.txt"]) {
      const response = await app.inject({ url: `/install/${path}` });
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain("private-value");
    }
  });

  it("rejects asset symlinks and malformed templates", async () => {
    await rm(join(dir, FILENAMES[0]));
    await symlink(join(dir, "SHA256SUMS"), join(dir, FILENAMES[0]));
    const linked = await app.inject({ url: `/install/${FILENAMES[0]}` });
    expect(linked.statusCode).toBe(503);
    expect(linked.json().code).toBe("installer_unavailable");
    await writeFile(join(dir, "install.sh"), "#!/bin/sh\nprintf unexpected");
    expect((await app.inject({ url: "/install" })).statusCode).toBe(503);
  });

  it("reports unavailable assets instead of falling back to an external download", async () => {
    await app.close(); app = server({ INSTALLER_ASSETS_DIR: "" });
    for (const path of ["/install", `/install/${FILENAMES[0]}`]) {
      const response = await app.inject({ url: path });
      expect(response.statusCode).toBe(503);
      expect(response.json().code).toBe("installer_unavailable");
    }
    await app.close(); app = server();
    await rm(join(dir, "install.sh"));
    expect((await app.inject({ url: "/install" })).statusCode).toBe(503);
    await rm(join(dir, FILENAMES[0]));
    expect((await app.inject({ url: `/install/${FILENAMES[0]}` })).statusCode).toBe(503);
  });
});
