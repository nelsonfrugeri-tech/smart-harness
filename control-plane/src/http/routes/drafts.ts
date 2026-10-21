import type { FastifyInstance } from "fastify";
import { recordAuditEvent } from "../../db/repos/audit.ts";
import { submitDraft } from "../../db/repos/contributions.ts";
import { findDraft, insertDraft, listOwnDrafts, markDraftValidated, updateDraft, type DraftRecord } from "../../db/repos/drafts.ts";
import { isAdminOf, type Principal } from "../../domain/access.ts";
import {
  buildDraft,
  DRAFT_BODY_LIMIT_BYTES,
  DraftFilesError,
  filesProblems,
  type DraftFile,
  type FileProblem,
} from "../../domain/drafts.ts";
import { PublishError, VISIBILITIES, type Visibility } from "../../domain/marketplace.ts";
import type { HarnessClient } from "../../domain/publish.ts";
import type { PackageStorage } from "../../storage/packages.ts";
import { authenticate, GATEWAY_TOKEN_ALLOWED, type AuthDeps } from "../auth.ts";
import { contributionView, draftEtag, draftSummaryView, draftView, findingView } from "../contribution-views.ts";
import { decodeTimeCursor, pageQuerySchema, timeCursorKey, toPage } from "../pagination.ts";
import { conflict, forbidden, HttpProblem, notFound } from "../problem.ts";
import { DIGEST_HEADER } from "./marketplace.ts";

export interface DraftDeps extends AuthDeps {
  storage: PackageStorage;
  harness: HarnessClient;
}

// Same characters as the CLI's ValidDraftID, so `harness draft pull <id>` accepts every id.
const draftParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", pattern: "^[A-Za-z0-9_-]{1,100}$" } },
} as const;

const filesSchema = {
  type: "array",
  minItems: 1,
  items: {
    type: "object",
    required: ["path", "content"],
    additionalProperties: false,
    properties: { path: { type: "string" }, content: { type: "string" } },
  },
} as const;

interface CreateBody {
  tenant: string;
  visibility?: Visibility;
  files: DraftFile[];
}

interface PatchBody {
  visibility?: Visibility;
  files?: DraftFile[];
}

interface PageQuery {
  cursor?: string;
  limit: number;
}

// Drafts are private to their author; an ADMIN of the draft's squad may also read one (to review
// it). Anyone else gets 404, as for a missing draft. Only the author writes, validates or submits.
// Writes accept only the login JWT; the archive also accepts the gateway token, like the
// Marketplace archive, because `harness draft pull` uses it.
export function registerDraftRoutes(app: FastifyInstance, deps: DraftDeps): void {
  app.post<{ Body: CreateBody }>(
    "/v1/drafts",
    {
      bodyLimit: DRAFT_BODY_LIMIT_BYTES,
      schema: {
        body: {
          type: "object",
          required: ["tenant", "files"],
          additionalProperties: false,
          properties: {
            tenant: { type: "string", minLength: 1, maxLength: 100 },
            visibility: { type: "string", enum: VISIBILITIES },
            files: filesSchema,
          },
        },
      },
    },
    async (request, reply) => {
      const principal = await authenticate(request, deps);
      const membership = principal.memberships.find((candidate) => candidate.tenant.slug === request.body.tenant);
      if (!membership) throw notFound("tenant not found");
      checkFiles(request.body.files);

      const draft = insertDraft(deps.db, principal.scope, {
        tenantId: membership.tenant.id,
        visibility: request.body.visibility ?? "squad",
        files: request.body.files,
      });
      return reply.code(201).header("etag", draftEtag(draft.revision)).send(draftView(draft));
    },
  );

  app.get<{ Querystring: PageQuery }>(
    "/v1/drafts",
    { schema: { querystring: { type: "object", properties: pageQuerySchema } } },
    async (request) => {
      const { scope } = await authenticate(request, deps);
      const { cursor, limit } = request.query;
      const rows = listOwnDrafts(deps.db, scope, { after: decodeTimeCursor(cursor), limit: limit + 1 });
      const page = toPage(rows, limit, timeCursorKey);
      return { items: page.rows.map(draftSummaryView), next_cursor: page.nextCursor };
    },
  );

  app.get<{ Params: { id: string } }>("/v1/drafts/:id", { schema: { params: draftParams } }, async (request, reply) => {
    const principal = await authenticate(request, deps);
    const draft = readableDraft(deps, principal, request.params.id);
    return reply.header("etag", draftEtag(draft.revision)).send(draftView(draft));
  });

  app.patch<{ Params: { id: string }; Body: PatchBody }>(
    "/v1/drafts/:id",
    {
      bodyLimit: DRAFT_BODY_LIMIT_BYTES,
      schema: {
        params: draftParams,
        body: {
          type: "object",
          minProperties: 1,
          additionalProperties: false,
          properties: { visibility: { type: "string", enum: VISIBILITIES }, files: filesSchema },
        },
      },
    },
    async (request, reply) => {
      const principal = await authenticate(request, deps);
      const draft = ownDraft(deps, principal, request.params.id);
      const expectedRevision = ifMatchRevision(request.headers["if-match"]);
      if (expectedRevision !== draft.revision) {
        throw new HttpProblem(412, "revision_mismatch", `draft is at revision ${draft.revision}; read it again`);
      }
      if (request.body.files !== undefined) checkFiles(request.body.files);

      const result = updateDraft(deps.db, principal.scope, {
        id: draft.id,
        expectedRevision,
        files: request.body.files,
        visibility: request.body.visibility,
      });
      if (result.status === "revision_mismatch") {
        throw new HttpProblem(412, "revision_mismatch", "draft changed meanwhile; read it again");
      }
      if (result.invalidatedContributions > 0) {
        recordAuditEvent(deps.db, principal.scope, {
          action: "contribution.invalidated",
          tenantId: draft.tenantId,
          correlationId: request.id,
          details: { draft_id: draft.id, revision: result.draft.revision },
        });
      }
      return reply.header("etag", draftEtag(result.draft.revision)).send(draftView(result.draft));
    },
  );

  // Packs the current revision with the harness binary and, when valid, stores the archive in
  // object storage under its digest. The digest recorded is the one of `harness pack` after
  // `generate`, which is the archive `harness draft pull` downloads and the approval publishes.
  app.post<{ Params: { id: string } }>(
    "/v1/drafts/:id/validate",
    { schema: { params: draftParams } },
    async (request) => {
      const principal = await authenticate(request, deps);
      const draft = ownDraft(deps, principal, request.params.id);

      let build;
      try {
        build = await buildDraft(deps.harness, draft.files);
      } catch (error) {
        if (error instanceof DraftFilesError) throw invalidPaths(draft.files, error.problems);
        if (error instanceof PublishError) throw new HttpProblem(422, error.code, error.message);
        throw error;
      }
      const findings = build.report.findings.map(findingView);
      if (build.prepared === undefined) return { valid: false, digest: null, findings };

      const { archive, digest, manifest } = build.prepared;
      await deps.storage.putPackage(digest, archive);
      const recorded = markDraftValidated(deps.db, principal.scope, draft.id, {
        revision: draft.revision,
        digest,
        sizeBytes: archive.byteLength,
        manifest,
      });
      if (!recorded) throw conflict("draft_changed", "draft changed during validation; validate it again");
      return { valid: true, digest, findings };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/drafts/:id/archive",
    { config: GATEWAY_TOKEN_ALLOWED, schema: { params: draftParams } },
    async (request, reply) => {
      const principal = await authenticate(request, deps);
      const draft = readableDraft(deps, principal, request.params.id);
      if (draft.validation === null) {
        throw conflict("draft_not_validated", "validate the current revision of the draft first");
      }
      const { digest } = draft.validation;
      const archive = await deps.storage.getPackage(digest);
      if (!archive) throw new Error(`archive ${digest} of draft ${draft.id} is missing from object storage`);
      return reply
        .header("content-type", "application/gzip")
        .header("content-disposition", `attachment; filename="draft-${draft.id}.tar.gz"`)
        .header(DIGEST_HEADER, digest)
        // The same URL serves another digest after the next validation.
        .header("cache-control", "private, no-store")
        .send(Buffer.from(archive));
    },
  );

  app.post<{ Params: { id: string } }>(
    "/v1/drafts/:id/submit",
    { schema: { params: draftParams } },
    async (request, reply) => {
      const principal = await authenticate(request, deps);
      const draft = ownDraft(deps, principal, request.params.id);
      const result = submitDraft(deps.db, principal.scope, draft.id);
      if (result.status === "draft_not_validated") {
        throw conflict("draft_not_validated", "validate the current revision of the draft first");
      }
      if (result.status === "contribution_open") {
        throw conflict("contribution_open", "this draft already has a submitted contribution");
      }
      recordAuditEvent(deps.db, principal.scope, {
        action: "contribution.submitted",
        tenantId: draft.tenantId,
        correlationId: request.id,
        details: { contribution_id: result.contribution.id, draft_id: draft.id, digest: result.contribution.digest },
      });
      return reply.code(201).send(contributionView(result.contribution));
    },
  );
}

function readableDraft(deps: DraftDeps, principal: Principal, id: string): DraftRecord {
  const draft = findDraft(deps.db, principal.scope, id);
  if (!draft || (draft.author.id !== principal.user.id && !isAdminOf(principal, draft.tenantId))) {
    throw notFound("draft not found");
  }
  return draft;
}

function ownDraft(deps: DraftDeps, principal: Principal, id: string): DraftRecord {
  const draft = readableDraft(deps, principal, id);
  if (draft.author.id !== principal.user.id) throw forbidden("forbidden", "only the author changes a draft");
  return draft;
}

// Every path and size is checked before the draft is stored, and again before :validate writes.
function checkFiles(files: DraftFile[]): void {
  const { paths, tooLarge } = filesProblems(files);
  if (paths.length > 0) throw invalidPaths(files, paths);
  if (tooLarge !== undefined) throw new HttpProblem(413, "draft_too_large", tooLarge);
}

function invalidPaths(files: readonly DraftFile[], problems: FileProblem[]): HttpProblem {
  return new HttpProblem(
    400,
    "invalid_path",
    "draft has invalid file paths; nothing was written",
    {},
    problems.map(({ index, reason }) => ({ path: `/files/${index}/path`, message: `${JSON.stringify(files[index].path)}: ${reason}` })),
  );
}

// If-Match carries the ETag of the revision the client edited: "3" (or 3).
function ifMatchRevision(header: string | undefined): number {
  if (header === undefined || header.trim() === "") {
    throw new HttpProblem(428, "if_match_required", 'send If-Match with the draft ETag, for example If-Match: "3"');
  }
  const match = /^\s*"?(\d{1,15})"?\s*$/.exec(header);
  return match ? Number(match[1]) : -1;
}
