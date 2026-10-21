// Shared steps of the contribution flow tests: create, validate and submit a draft over HTTP.
import type { FastifyInstance } from "fastify";
import type { Db } from "../../../src/db/database.ts";
import { upsertMembership, upsertUser } from "../../../src/db/repos/seed.ts";
import { tenantId } from "../../test-support.ts";

export const DEV = "dev@smart-harness.local"; // DEV in investimentos and conta
export const ADMIN = "admin@smart-harness.local"; // ADMIN in every squad
export const CARTOES_DEV = "dev.cartoes@smart-harness.local"; // DEV in cartoes only
export const SECOND_DEV = "dev2@smart-harness.local"; // DEV in investimentos, added by addSecondDev
export const SECOND_ADMIN = "admin2@smart-harness.local"; // ADMIN in investimentos, added by addSecondAdmin

export function addSecondDev(db: Db): void {
  upsertMembership(db, upsertUser(db, { email: SECOND_DEV, name: "Dev Two" }), tenantId(db, "investimentos"), "DEV");
}

export function addSecondAdmin(db: Db): void {
  upsertMembership(db, upsertUser(db, { email: SECOND_ADMIN, name: "Admin Two" }), tenantId(db, "investimentos"), "ADMIN");
}

export function packageFiles(name = "demo-contrib", version = "1.0.0", extra: { path: string; content: string }[] = []) {
  return [
    { path: "plugin.json", content: JSON.stringify({ name, version, description: `${name} contribution.` }) },
    { path: "skills/demo-skill/SKILL.md", content: "---\nname: demo-skill\ndescription: Demo.\n---\nBody.\n" },
    ...extra,
  ];
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export async function createDraft(
  app: FastifyInstance,
  token: string,
  payload: { tenant?: string; visibility?: string; files?: { path: string; content: string }[] } = {},
) {
  return app.inject({
    method: "POST",
    url: "/v1/drafts",
    headers: bearer(token),
    payload: { tenant: payload.tenant ?? "investimentos", files: payload.files ?? packageFiles(), ...(payload.visibility ? { visibility: payload.visibility } : {}) },
  });
}

export async function validateDraft(app: FastifyInstance, token: string, id: string) {
  return app.inject({ method: "POST", url: `/v1/drafts/${id}/validate`, headers: bearer(token) });
}

export async function submitDraft(app: FastifyInstance, token: string, id: string) {
  return app.inject({ method: "POST", url: `/v1/drafts/${id}/submit`, headers: bearer(token) });
}

// Creates, validates and submits a draft; returns the ids and the validated digest.
export async function submittedContribution(
  app: FastifyInstance,
  token: string,
  files = packageFiles(),
): Promise<{ draftId: string; contributionId: string; digest: string }> {
  const created = await createDraft(app, token, { files });
  if (created.statusCode !== 201) throw new Error(`create answered ${created.statusCode}: ${created.body}`);
  const draftId = created.json<{ id: string }>().id;
  const validated = await validateDraft(app, token, draftId);
  if (validated.statusCode !== 200 || !validated.json().valid) {
    throw new Error(`validate answered ${validated.statusCode}: ${validated.body}`);
  }
  const submitted = await submitDraft(app, token, draftId);
  if (submitted.statusCode !== 201) throw new Error(`submit answered ${submitted.statusCode}: ${submitted.body}`);
  return { draftId, contributionId: submitted.json<{ id: string }>().id, digest: validated.json<{ digest: string }>().digest };
}
