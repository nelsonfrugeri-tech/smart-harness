// Approval with four eyes: an ADMIN of the contribution's squad who is not its author approves
// the digest they reviewed. The archive is already in object storage (stored at :validate under
// its digest), so approving is only database work: one synchronous IMMEDIATE transaction that
// re-reads the contribution, checks it, records the version, publishes the contribution and
// writes the audit event. Any failure rolls all of it back. No binary and no storage call here.
import type { Db } from "../db/database.ts";
import { recordAuditEvent } from "../db/repos/audit.ts";
import { findContribution, markContributionPublished, type ContributionRecord } from "../db/repos/contributions.ts";
import { insertPublishedVersion } from "../db/repos/marketplace.ts";
import { isAdminOf, type Principal } from "./access.ts";
import { PublishError } from "./marketplace.ts";

export type ApprovalErrorCode =
  | "not_found"
  | "forbidden"
  | "self_approval"
  | "contribution_not_submitted"
  | "digest_mismatch"
  | "version_exists"
  | "plugin_owned_by_other_squad";

export class ApprovalError extends Error {
  readonly code: ApprovalErrorCode;

  constructor(code: ApprovalErrorCode, message: string) {
    super(message);
    this.name = "ApprovalError";
    this.code = code;
  }
}

export interface Approval {
  contributionId: string;
  // The digest the reviewer saw; it must be the contribution's digest.
  digest: string;
  comment: string | null;
  correlationId: string;
}

export function approveContribution(db: Db, reviewer: Principal, approval: Approval): ContributionRecord {
  return db
    .transaction(() => {
      const contribution = findContribution(db, reviewer.scope, approval.contributionId);
      if (!contribution) throw new ApprovalError("not_found", "contribution not found");
      if (contribution.author.id === reviewer.user.id) {
        throw new ApprovalError("self_approval", "the author cannot approve their own contribution");
      }
      if (!isAdminOf(reviewer, contribution.tenantId)) {
        throw new ApprovalError("forbidden", "only an ADMIN of the contribution's squad can approve it");
      }
      if (contribution.state !== "submitted") {
        throw new ApprovalError("contribution_not_submitted", `contribution is ${contribution.state}, not submitted`);
      }
      if (approval.digest !== contribution.digest) {
        throw new ApprovalError(
          "digest_mismatch",
          `approved digest ${approval.digest} is not the submitted digest ${contribution.digest}`,
        );
      }

      const { versionId } = publish(db, reviewer, contribution);
      if (!markContributionPublished(db, { id: contribution.id, reviewerId: reviewer.user.id, comment: approval.comment, versionId })) {
        throw new ApprovalError("contribution_not_submitted", "contribution changed during the approval");
      }
      recordAuditEvent(db, reviewer.scope, {
        action: "contribution.approved",
        tenantId: contribution.tenantId,
        correlationId: approval.correlationId,
        details: {
          contribution_id: contribution.id,
          draft_id: contribution.draftId,
          plugin: contribution.manifest.name,
          version: contribution.manifest.version,
          digest: contribution.digest,
          author_id: contribution.author.id,
        },
      });

      const published = findContribution(db, reviewer.scope, contribution.id);
      if (!published) throw new Error(`contribution ${contribution.id} disappeared during the approval`);
      return published;
    })
    .immediate();
}

function publish(db: Db, reviewer: Principal, contribution: ContributionRecord): { versionId: number } {
  try {
    return insertPublishedVersion(db, reviewer.user.id, {
      tenantId: contribution.tenantId,
      visibility: contribution.visibility,
      manifest: contribution.manifest,
      digest: contribution.digest,
      sizeBytes: contribution.sizeBytes,
    });
  } catch (error) {
    if (error instanceof PublishError && (error.code === "version_exists" || error.code === "plugin_owned_by_other_squad")) {
      throw new ApprovalError(error.code, error.message);
    }
    throw error;
  }
}
