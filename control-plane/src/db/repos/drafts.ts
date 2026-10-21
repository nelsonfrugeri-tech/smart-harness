import { randomUUID } from "node:crypto";
import type { Db } from "../database.ts";
import { scopeTenantIdsJson, type Scope } from "../../domain/access.ts";
import type { DraftFile } from "../../domain/drafts.ts";
import type { PackageManifest, Visibility } from "../../domain/marketplace.ts";

// Every read is limited to tenants in the scope. Who may read or write a draft inside its tenant
// (the author, or an ADMIN of the tenant for reads) is decided by the caller.

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

const SUMMARY_COLUMNS = `d.id, d.tenant_id AS tenantId, t.slug AS tenantSlug, t.name AS tenantName,
  d.author_id AS authorId, u.email AS authorEmail, u.name AS authorName, d.visibility, d.revision,
  d.validated_revision AS validatedRevision, d.validated_digest AS validatedDigest,
  d.validated_size_bytes AS validatedSizeBytes, d.validated_manifest AS validatedManifest,
  json_array_length(d.files) AS fileCount, d.created_at AS createdAt, d.updated_at AS updatedAt`;

const FROM = `FROM drafts d JOIN tenants t ON t.id = d.tenant_id JOIN users u ON u.id = d.author_id`;

export interface DraftValidation {
  revision: number;
  digest: string;
  sizeBytes: number;
  manifest: PackageManifest;
}

export interface DraftSummary {
  id: string;
  tenantId: string;
  tenant: { slug: string; name: string };
  author: { id: string; email: string; name: string };
  visibility: Visibility;
  revision: number;
  // null until :validate succeeds for the current revision.
  validation: DraftValidation | null;
  fileCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DraftRecord extends DraftSummary {
  files: DraftFile[];
}

interface SummaryRow {
  id: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  authorId: string;
  authorEmail: string;
  authorName: string;
  visibility: Visibility;
  revision: number;
  validatedRevision: number | null;
  validatedDigest: string | null;
  validatedSizeBytes: number | null;
  validatedManifest: string | null;
  fileCount: number;
  createdAt: string;
  updatedAt: string;
}

function toSummary(row: SummaryRow): DraftSummary {
  const validation =
    row.validatedRevision === null || row.validatedDigest === null || row.validatedManifest === null
      ? null
      : {
          revision: row.validatedRevision,
          digest: row.validatedDigest,
          sizeBytes: row.validatedSizeBytes ?? 0,
          manifest: JSON.parse(row.validatedManifest) as PackageManifest,
        };
  return {
    id: row.id,
    tenantId: row.tenantId,
    tenant: { slug: row.tenantSlug, name: row.tenantName },
    author: { id: row.authorId, email: row.authorEmail, name: row.authorName },
    visibility: row.visibility,
    revision: row.revision,
    validation,
    fileCount: row.fileCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function assertInScope(scope: Scope, tenantId: string): void {
  if (!(JSON.parse(scopeTenantIdsJson(scope)) as string[]).includes(tenantId)) {
    throw new Error(`tenant ${tenantId} is outside the caller's scope`);
  }
}

// Creates a draft authored by the scope's user, at revision 1.
export function insertDraft(
  db: Db,
  scope: Scope,
  draft: { tenantId: string; visibility: Visibility; files: DraftFile[] },
): DraftRecord {
  assertInScope(scope, draft.tenantId);
  const id = randomUUID();
  db.prepare("INSERT INTO drafts (id, tenant_id, author_id, visibility, files) VALUES (?, ?, ?, ?, ?)").run(
    id,
    draft.tenantId,
    scope.userId,
    draft.visibility,
    JSON.stringify(draft.files),
  );
  const created = findDraft(db, scope, id);
  if (!created) throw new Error(`draft ${id} was not found right after insert`);
  return created;
}

// undefined when the draft does not exist or belongs to a tenant outside the scope.
export function findDraft(db: Db, scope: Scope, id: string): DraftRecord | undefined {
  const row = db
    .prepare(`SELECT ${SUMMARY_COLUMNS}, d.files ${FROM} WHERE d.id = ? AND d.tenant_id IN (SELECT value FROM json_each(?))`)
    .get(id, scopeTenantIdsJson(scope)) as (SummaryRow & { files: string }) | undefined;
  if (!row) return undefined;
  return { ...toSummary(row), files: JSON.parse(row.files) as DraftFile[] };
}

// The scope user's own drafts, newest first, without file contents.
// `after` is the (created_at, id) of the last row of the previous page.
export function listOwnDrafts(
  db: Db,
  scope: Scope,
  page: { after?: { createdAt: string; id: string }; limit: number },
): DraftSummary[] {
  const after = page.after ?? null;
  const rows = db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS} ${FROM}
        WHERE d.author_id = @user
          AND d.tenant_id IN (SELECT value FROM json_each(@scope))
          AND (@afterAt IS NULL OR (d.created_at, d.id) < (@afterAt, @afterId))
        ORDER BY d.created_at DESC, d.id DESC
        LIMIT @limit`,
    )
    .all({
      user: scope.userId,
      scope: scopeTenantIdsJson(scope),
      afterAt: after?.createdAt ?? null,
      afterId: after?.id ?? null,
      limit: page.limit,
    }) as SummaryRow[];
  return rows.map(toSummary);
}

export type UpdateDraftResult =
  | { status: "updated"; draft: DraftRecord; invalidatedContributions: number }
  | { status: "revision_mismatch" };

// Replaces the files and/or visibility of the scope user's draft when it is still at
// expectedRevision. In one transaction: bumps the revision, clears the validation and turns the
// draft's submitted contribution into invalidated, so an approval can never publish a stale revision.
export function updateDraft(
  db: Db,
  scope: Scope,
  change: { id: string; expectedRevision: number; files?: DraftFile[]; visibility?: Visibility },
): UpdateDraftResult {
  return db
    .transaction((): UpdateDraftResult => {
      const { changes } = db
        .prepare(
          `UPDATE drafts
              SET files = coalesce(@files, files),
                  visibility = coalesce(@visibility, visibility),
                  revision = revision + 1,
                  validated_revision = NULL,
                  validated_digest = NULL,
                  validated_size_bytes = NULL,
                  validated_manifest = NULL,
                  updated_at = ${NOW}
            WHERE id = @id AND author_id = @user AND revision = @revision
              AND tenant_id IN (SELECT value FROM json_each(@scope))`,
        )
        .run({
          id: change.id,
          user: scope.userId,
          revision: change.expectedRevision,
          scope: scopeTenantIdsJson(scope),
          files: change.files === undefined ? null : JSON.stringify(change.files),
          visibility: change.visibility ?? null,
        });
      if (changes === 0) return { status: "revision_mismatch" };

      const invalidated = db
        .prepare(
          `UPDATE contributions SET state = 'invalidated', updated_at = ${NOW}
            WHERE draft_id = ? AND state = 'submitted'`,
        )
        .run(change.id).changes;
      const draft = findDraft(db, scope, change.id);
      if (!draft) throw new Error(`draft ${change.id} disappeared during update`);
      return { status: "updated", draft, invalidatedContributions: invalidated };
    })
    .immediate();
}

// Records a successful validation of `revision`. Returns false when the draft moved to another
// revision while it was being validated: an old result never overwrites a newer revision.
export function markDraftValidated(db: Db, scope: Scope, id: string, validation: DraftValidation): boolean {
  const { changes } = db
    .prepare(
      `UPDATE drafts
          SET validated_revision = revision,
              validated_digest = @digest,
              validated_size_bytes = @size,
              validated_manifest = @manifest,
              updated_at = ${NOW}
        WHERE id = @id AND revision = @revision AND author_id = @user
          AND tenant_id IN (SELECT value FROM json_each(@scope))`,
    )
    .run({
      id,
      revision: validation.revision,
      user: scope.userId,
      scope: scopeTenantIdsJson(scope),
      digest: validation.digest,
      size: validation.sizeBytes,
      manifest: JSON.stringify(validation.manifest),
    });
  return changes === 1;
}
