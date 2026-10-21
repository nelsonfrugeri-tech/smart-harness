import { randomUUID } from "node:crypto";
import type { Db } from "../database.ts";
import { scopeTenantIdsJson, type Scope } from "../../domain/access.ts";
import type { PackageManifest, Visibility } from "../../domain/marketplace.ts";

// Every read is limited to tenants in the scope. Who may read or review a contribution inside its
// tenant is decided by the caller.

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export type ContributionState = "submitted" | "invalidated" | "published";

const COLUMNS = `c.id, c.draft_id AS draftId, c.tenant_id AS tenantId, t.slug AS tenantSlug, t.name AS tenantName,
  c.author_id AS authorId, a.email AS authorEmail, a.name AS authorName, c.revision, c.digest,
  c.size_bytes AS sizeBytes, c.manifest, c.visibility, c.state, c.reviewer_id AS reviewerId,
  r.email AS reviewerEmail, r.name AS reviewerName, c.review_comment AS reviewComment,
  c.reviewed_at AS reviewedAt, c.created_at AS createdAt, c.updated_at AS updatedAt`;

const FROM = `FROM contributions c
  JOIN tenants t ON t.id = c.tenant_id
  JOIN users a ON a.id = c.author_id
  LEFT JOIN users r ON r.id = c.reviewer_id`;

export interface ContributionRecord {
  id: string;
  draftId: string;
  tenantId: string;
  tenant: { slug: string; name: string };
  author: { id: string; email: string; name: string };
  revision: number;
  digest: string;
  sizeBytes: number;
  manifest: PackageManifest;
  visibility: Visibility;
  state: ContributionState;
  reviewer: { id: string; email: string; name: string } | null;
  reviewComment: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  draftId: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  authorId: string;
  authorEmail: string;
  authorName: string;
  revision: number;
  digest: string;
  sizeBytes: number;
  manifest: string;
  visibility: Visibility;
  state: ContributionState;
  reviewerId: string | null;
  reviewerEmail: string | null;
  reviewerName: string | null;
  reviewComment: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toRecord(row: Row): ContributionRecord {
  return {
    id: row.id,
    draftId: row.draftId,
    tenantId: row.tenantId,
    tenant: { slug: row.tenantSlug, name: row.tenantName },
    author: { id: row.authorId, email: row.authorEmail, name: row.authorName },
    revision: row.revision,
    digest: row.digest,
    sizeBytes: row.sizeBytes,
    manifest: JSON.parse(row.manifest) as PackageManifest,
    visibility: row.visibility,
    state: row.state,
    reviewer:
      row.reviewerId === null
        ? null
        : { id: row.reviewerId, email: row.reviewerEmail ?? "", name: row.reviewerName ?? "" },
    reviewComment: row.reviewComment,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type SubmitResult =
  | { status: "created"; contribution: ContributionRecord }
  | { status: "draft_not_validated" }
  | { status: "contribution_open" };

// Submits the current revision of the scope user's draft. The digest, size and manifest are the
// ones :validate recorded for that revision; a draft without a validation of its current revision
// cannot be submitted. One submitted contribution per draft (unique index).
export function submitDraft(db: Db, scope: Scope, draftId: string): SubmitResult {
  return db
    .transaction((): SubmitResult => {
      const draft = db
        .prepare(
          `SELECT tenant_id AS tenantId, visibility, revision, validated_revision AS validatedRevision,
                  validated_digest AS digest, validated_size_bytes AS sizeBytes, validated_manifest AS manifest
             FROM drafts
            WHERE id = ? AND author_id = ? AND tenant_id IN (SELECT value FROM json_each(?))`,
        )
        .get(draftId, scope.userId, scopeTenantIdsJson(scope)) as
        | {
            tenantId: string;
            visibility: Visibility;
            revision: number;
            validatedRevision: number | null;
            digest: string | null;
            sizeBytes: number | null;
            manifest: string | null;
          }
        | undefined;
      if (!draft || draft.validatedRevision !== draft.revision || draft.digest === null) {
        return { status: "draft_not_validated" };
      }
      const open = db.prepare("SELECT 1 FROM contributions WHERE draft_id = ? AND state = 'submitted'").get(draftId);
      if (open) return { status: "contribution_open" };

      const id = randomUUID();
      db.prepare(
        `INSERT INTO contributions (id, draft_id, tenant_id, author_id, revision, digest, size_bytes, manifest, visibility)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        draftId,
        draft.tenantId,
        scope.userId,
        draft.revision,
        draft.digest,
        draft.sizeBytes,
        draft.manifest,
        draft.visibility,
      );
      const contribution = findContribution(db, scope, id);
      if (!contribution) throw new Error(`contribution ${id} was not found right after insert`);
      return { status: "created", contribution };
    })
    .immediate();
}

// undefined when the contribution does not exist or belongs to a tenant outside the scope.
export function findContribution(db: Db, scope: Scope, id: string): ContributionRecord | undefined {
  const row = db
    .prepare(`SELECT ${COLUMNS} ${FROM} WHERE c.id = ? AND c.tenant_id IN (SELECT value FROM json_each(?))`)
    .get(id, scopeTenantIdsJson(scope)) as Row | undefined;
  return row ? toRecord(row) : undefined;
}

export type ContributionView =
  // The scope user's own contributions, in every state.
  | { kind: "mine" }
  // Submitted contributions of these tenants, written by someone else: the review queue.
  | { kind: "review"; tenantIds: readonly string[] };

// Newest first. `after` is the (created_at, id) of the last row of the previous page.
export function listContributions(
  db: Db,
  scope: Scope,
  view: ContributionView,
  page: { after?: { createdAt: string; id: string }; limit: number },
): ContributionRecord[] {
  const after = page.after ?? null;
  const filter =
    view.kind === "mine"
      ? "c.author_id = @user"
      : "c.state = 'submitted' AND c.author_id <> @user AND c.tenant_id IN (SELECT value FROM json_each(@review))";
  const rows = db
    .prepare(
      `SELECT ${COLUMNS} ${FROM}
        WHERE ${filter}
          AND c.tenant_id IN (SELECT value FROM json_each(@scope))
          AND (@afterAt IS NULL OR (c.created_at, c.id) < (@afterAt, @afterId))
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT @limit`,
    )
    .all({
      user: scope.userId,
      scope: scopeTenantIdsJson(scope),
      ...(view.kind === "review" ? { review: JSON.stringify(view.tenantIds) } : {}),
      afterAt: after?.createdAt ?? null,
      afterId: after?.id ?? null,
      limit: page.limit,
    }) as Row[];
  return rows.map(toRecord);
}

// Moves a submitted contribution to published. Returns false when it is no longer submitted.
// Runs inside the approval transaction.
export function markContributionPublished(
  db: Db,
  review: { id: string; reviewerId: string; comment: string | null; versionId: number },
): boolean {
  const { changes } = db
    .prepare(
      `UPDATE contributions
          SET state = 'published', reviewer_id = @reviewer, review_comment = @comment,
              reviewed_at = ${NOW}, version_id = @version, updated_at = ${NOW}
        WHERE id = @id AND state = 'submitted'`,
    )
    .run({ id: review.id, reviewer: review.reviewerId, comment: review.comment, version: review.versionId });
  return changes === 1;
}
