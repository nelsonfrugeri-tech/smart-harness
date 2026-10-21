// JSON shapes of the draft and contribution responses (snake_case, as described in openapi.json).
import type { ContributionRecord } from "../db/repos/contributions.ts";
import type { DraftRecord, DraftSummary } from "../db/repos/drafts.ts";
import type { PackageManifest } from "../domain/marketplace.ts";
import type { ValidationFinding } from "../domain/publish.ts";

export function draftArchiveUrl(draftId: string): string {
  return `/v1/drafts/${draftId}/archive`;
}

// The ETag of a draft is its revision; PATCH sends it back in If-Match.
export function draftEtag(revision: number): string {
  return `"${revision}"`;
}

function pluginOf(manifest: PackageManifest) {
  return { name: manifest.name, version: manifest.version, description: manifest.description };
}

export function draftSummaryView(draft: DraftSummary) {
  return {
    id: draft.id,
    tenant: draft.tenant,
    author: { email: draft.author.email, name: draft.author.name },
    visibility: draft.visibility,
    revision: draft.revision,
    file_count: draft.fileCount,
    validation:
      draft.validation === null
        ? null
        : {
            revision: draft.validation.revision,
            digest: draft.validation.digest,
            size_bytes: draft.validation.sizeBytes,
            plugin: pluginOf(draft.validation.manifest),
            components: draft.validation.manifest.components,
            archive_url: draftArchiveUrl(draft.id),
          },
    created_at: draft.createdAt,
    updated_at: draft.updatedAt,
  };
}

export function draftView(draft: DraftRecord) {
  return { ...draftSummaryView(draft), files: draft.files };
}

export function findingView(finding: ValidationFinding) {
  return {
    code: finding.code,
    severity: finding.severity ?? "error",
    message: finding.message,
    hint: finding.hint ?? "",
    path: finding.path ?? "",
    line: finding.line ?? 0,
  };
}

export function contributionView(contribution: ContributionRecord) {
  return {
    id: contribution.id,
    draft_id: contribution.draftId,
    tenant: contribution.tenant,
    author: { email: contribution.author.email, name: contribution.author.name },
    revision: contribution.revision,
    digest: contribution.digest,
    size_bytes: contribution.sizeBytes,
    plugin: pluginOf(contribution.manifest),
    components: contribution.manifest.components,
    visibility: contribution.visibility,
    state: contribution.state,
    reviewer:
      contribution.reviewer === null ? null : { email: contribution.reviewer.email, name: contribution.reviewer.name },
    review_comment: contribution.reviewComment,
    reviewed_at: contribution.reviewedAt,
    created_at: contribution.createdAt,
    updated_at: contribution.updatedAt,
  };
}
