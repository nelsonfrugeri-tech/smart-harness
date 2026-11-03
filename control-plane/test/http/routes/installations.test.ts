import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../../src/db/database.ts";
import { login, marketplaceFixture, testServer, userId } from "../../test-support.ts";

const DEV = "dev@smart-harness.local"; // DEV in investimentos and conta
const DEV_CARTOES = "dev.cartoes@smart-harness.local";
const INSTALLATIONS = "/v1/me/installations";
const OLD_TIME = "2020-01-01T00:00:00.000Z";

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("installations", () => {
  let db: Db;
  let app: FastifyInstance;
  let logs: string[];
  let jwt: string;
  let gatewayToken: string;

  beforeEach(async () => {
    const fixture = await marketplaceFixture();
    db = fixture.db;
    logs = [];
    app = testServer(db, "local", fixture.storage, { write: (line) => logs.push(line) });
    jwt = await login(app, DEV);
    const created = await app.inject({ method: "POST", url: "/v1/me/gateway-tokens", headers: bearer(jwt), payload: { name: "cli" } });
    gatewayToken = created.json().token;
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  const report = (payload: unknown, token = gatewayToken) =>
    app.inject({ method: "PUT", url: INSTALLATIONS, headers: bearer(token), payload: payload as object });
  const read = (token = jwt) => app.inject({ method: "GET", url: INSTALLATIONS, headers: bearer(token) });
  const rowsOf = (email: string) =>
    db
      .prepare(
        `SELECT p.name, i.version FROM user_installations i JOIN plugins p ON p.id = i.plugin_id
          WHERE i.user_id = ? ORDER BY p.name`,
      )
      .all(userId(db, email));

  it("GET before any report answers nulls and an empty list", async () => {
    const response = await read();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ cliVersion: null, reportedAt: null, plugins: [] });
  });

  it("PUT with the gateway token stores the set; GET with the JWT lists it ordered by name", async () => {
    const put = await report({
      cliVersion: "0.3.0",
      plugins: [
        { name: "graphify", version: "2.0.0" },
        { name: "deja-vu", version: "2.0.0" },
        { name: "code-review", version: "1.0.1" },
      ],
    });

    expect(put.statusCode).toBe(204);
    expect(put.body).toBe("");
    const response = await read();
    expect(response.statusCode).toBe(200);
    const installations = response.json();
    expect(installations).toMatchObject({
      cliVersion: "0.3.0",
      plugins: [
        { name: "code-review", version: "1.0.1" },
        { name: "deja-vu", version: "2.0.0" },
        { name: "graphify", version: "2.0.0" },
      ],
    });
    expect(installations.reportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    for (const plugin of installations.plugins) {
      expect(Object.keys(plugin).sort()).toEqual(["installedAt", "name", "version"]);
      expect(plugin.installedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });

  it("a second PUT replaces the whole set: kept plugins keep installedAt, absent ones are deleted", async () => {
    await report({ cliVersion: "0.3.0", plugins: [{ name: "graphify", version: "1.0.0" }, { name: "deja-vu", version: "1.0.0" }] });
    db.prepare("UPDATE user_installations SET installed_at = ?").run(OLD_TIME);
    db.prepare("UPDATE user_installation_reports SET reported_at = ?").run(OLD_TIME);

    const put = await report({
      cliVersion: "0.3.1",
      plugins: [{ name: "graphify", version: "2.0.0" }, { name: "investimentos-base", version: "1.2.2" }],
    });

    expect(put.statusCode).toBe(204);
    const installations = (await read()).json();
    expect(installations.cliVersion).toBe("0.3.1");
    expect(installations.reportedAt).not.toBe(OLD_TIME);
    expect(installations.plugins).toEqual([
      { name: "graphify", version: "2.0.0", installedAt: OLD_TIME },
      { name: "investimentos-base", version: "1.2.2", installedAt: expect.not.stringMatching(OLD_TIME) },
    ]);
  });

  it("an empty report clears the set and still records the CLI version", async () => {
    await report({ cliVersion: "0.3.0", plugins: [{ name: "graphify", version: "2.0.0" }] });

    expect((await report({ cliVersion: "0.4.0", plugins: [] })).statusCode).toBe(204);

    expect((await read()).json()).toMatchObject({ cliVersion: "0.4.0", plugins: [] });
    expect(rowsOf(DEV)).toEqual([]);
  });

  it("names outside the caller's catalog are ignored and logged; the rest is stored", async () => {
    // cartoes-base exists but belongs to a squad DEV is not in; missing-plugin does not exist.
    const put = await report({
      cliVersion: "0.3.0",
      plugins: [
        { name: "cartoes-base", version: "1.0.1" },
        { name: "graphify", version: "2.0.0" },
        { name: "missing-plugin", version: "1.0.0" },
      ],
    });

    expect(put.statusCode).toBe(204);
    expect(rowsOf(DEV)).toEqual([{ name: "graphify", version: "2.0.0" }]);
    const line = logs.map((entry) => JSON.parse(entry)).find((entry) => entry.ignored !== undefined);
    expect(line).toMatchObject({ ignored: ["cartoes-base", "missing-plugin"] });
  });

  it("when a name repeats, the last version wins", async () => {
    await report({ cliVersion: "0.3.0", plugins: [{ name: "graphify", version: "1.0.0" }, { name: "graphify", version: "2.0.0" }] });

    expect(rowsOf(DEV)).toEqual([{ name: "graphify", version: "2.0.0" }]);
  });

  it("PUT also accepts the JWT", async () => {
    const put = await report({ cliVersion: "web", plugins: [{ name: "graphify", version: "2.0.0" }] }, jwt);

    expect(put.statusCode).toBe(204);
    expect(rowsOf(DEV)).toEqual([{ name: "graphify", version: "2.0.0" }]);
  });

  it("GET refuses the gateway token with 401", async () => {
    const response = await read(gatewayToken);

    expect(response.statusCode).toBe(401);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toMatchObject({ status: 401, code: "gateway_token_not_allowed" });
  });

  it("both routes answer 401 without a token", async () => {
    expect((await app.inject({ method: "GET", url: INSTALLATIONS })).statusCode).toBe(401);
    const put = await app.inject({ method: "PUT", url: INSTALLATIONS, payload: { cliVersion: "0.3.0", plugins: [] } });
    expect(put.statusCode).toBe(401);
    expect(db.prepare("SELECT COUNT(*) AS n FROM user_installation_reports").get()).toEqual({ n: 0 });
  });

  it.each([
    ["more than 200 plugins", { cliVersion: "0.3.0", plugins: Array.from({ length: 201 }, (_, i) => ({ name: `p${i}`, version: "1.0.0" })) }],
    ["no cliVersion", { plugins: [] }],
    ["an empty cliVersion", { cliVersion: "", plugins: [] }],
    ["a cliVersion over 50 characters", { cliVersion: "x".repeat(51), plugins: [] }],
    ["no plugins", { cliVersion: "0.3.0" }],
    ["an invalid plugin name", { cliVersion: "0.3.0", plugins: [{ name: "Graphify", version: "2.0.0" }] }],
    ["an invalid version", { cliVersion: "0.3.0", plugins: [{ name: "graphify", version: "latest" }] }],
    ["a plugin without version", { cliVersion: "0.3.0", plugins: [{ name: "graphify" }] }],
  ])("PUT with %s answers 400 and keeps the previous set", async (_case, payload) => {
    await report({ cliVersion: "0.3.0", plugins: [{ name: "graphify", version: "2.0.0" }] });

    const put = await report(payload);

    expect(put.statusCode).toBe(400);
    expect(put.headers["content-type"]).toContain("application/problem+json");
    expect((await read()).json()).toMatchObject({ cliVersion: "0.3.0", plugins: [{ name: "graphify", version: "2.0.0" }] });
  });

  it("accepts exactly 200 plugins", async () => {
    const plugins = Array.from({ length: 200 }, (_, i) => ({ name: `p${i}`, version: "1.0.0" }));

    expect((await report({ cliVersion: "0.3.0", plugins })).statusCode).toBe(204);
  });

  it("a report changes only the caller's own set", async () => {
    const other = await login(app, DEV_CARTOES);
    await report({ cliVersion: "0.3.0", plugins: [{ name: "cartoes-base", version: "1.0.1" }] }, other);

    await report({ cliVersion: "0.3.0", plugins: [] });

    expect(rowsOf(DEV_CARTOES)).toEqual([{ name: "cartoes-base", version: "1.0.1" }]);
    expect((await read(other)).json().plugins).toEqual([expect.objectContaining({ name: "cartoes-base" })]);
    expect((await read()).json().plugins).toEqual([]);
  });
});
