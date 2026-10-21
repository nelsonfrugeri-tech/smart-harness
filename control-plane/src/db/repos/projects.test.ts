import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Scope } from "../../domain/access.ts";
import { seededDatabase, tenantId } from "../../test-support.ts";
import type { Db } from "../database.ts";
import { findProjectBySlug } from "./projects.ts";

describe("findProjectBySlug", () => {
  let db: Db;

  beforeEach(() => {
    db = seededDatabase();
  });

  afterEach(() => {
    db.close();
  });

  it("returns a project of a tenant in the scope", () => {
    const scope: Scope = { userId: "u", tenantIds: [tenantId(db, "investimentos")] };

    expect(findProjectBySlug(db, scope, "investimentos-api")).toMatchObject({
      slug: "investimentos-api",
      tenantId: tenantId(db, "investimentos"),
    });
  });

  it("returns nothing for a project of another tenant", () => {
    const scope: Scope = { userId: "u", tenantIds: [tenantId(db, "investimentos"), tenantId(db, "conta")] };

    expect(findProjectBySlug(db, scope, "cartoes-app")).toBeUndefined();
  });

  it("returns nothing when the scope has no tenants", () => {
    const scope: Scope = { userId: "u", tenantIds: [] };

    for (const slug of ["investimentos-api", "conta-digital", "cartoes-app"]) {
      expect(findProjectBySlug(db, scope, slug)).toBeUndefined();
    }
  });

  it("refuses to run without a scope", () => {
    expect(() => findProjectBySlug(db, undefined as unknown as Scope, "cartoes-app")).toThrow(
      "a tenant scope is required",
    );
  });
});
