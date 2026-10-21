-- Contributions: a validated draft revision submitted for review.
-- The digest, size and manifest are copied from the draft at submit, so the approval publishes
-- exactly what was submitted. An edit of the draft turns a submitted contribution into
-- invalidated; an approval turns it into published and points to the version it created.

CREATE TABLE contributions (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES drafts (id),
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  author_id TEXT NOT NULL REFERENCES users (id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  digest TEXT NOT NULL CHECK (length(digest) = 71 AND digest GLOB 'sha256:*' AND substr(digest, 8) NOT GLOB '*[^0-9a-f]*'),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  manifest TEXT NOT NULL CHECK (json_valid(manifest)),
  visibility TEXT NOT NULL CHECK (visibility IN ('squad', 'organization')),
  state TEXT NOT NULL DEFAULT 'submitted' CHECK (state IN ('submitted', 'invalidated', 'published')),
  reviewer_id TEXT REFERENCES users (id),
  review_comment TEXT,
  reviewed_at TEXT,
  version_id INTEGER REFERENCES plugin_versions (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Published means a reviewer, a review time and a version; the other states have none.
  CHECK ((state = 'published') = (version_id IS NOT NULL)),
  CHECK ((state = 'published') = (reviewer_id IS NOT NULL)),
  CHECK ((state = 'published') = (reviewed_at IS NOT NULL)),
  -- Four eyes: the author never reviews their own contribution.
  CHECK (reviewer_id <> author_id)
) STRICT;

-- At most one open (submitted) contribution per draft.
CREATE UNIQUE INDEX contributions_one_submitted_per_draft ON contributions (draft_id) WHERE state = 'submitted';
-- The review queue of a squad and the author's list, oldest or newest first.
CREATE INDEX contributions_tenant_state ON contributions (tenant_id, state, created_at, id);
CREATE INDEX contributions_author_id ON contributions (author_id, created_at, id);
