-- Drafts: a package a developer is writing, kept as text in the database until it is published.
-- files is a JSON array of {path, content}. Every edit bumps revision.
-- A successful :validate packs the draft, stores the archive in object storage under its digest
-- and records validated_* for the revision it packed. An edit clears validated_*.

CREATE TABLE drafts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  author_id TEXT NOT NULL REFERENCES users (id),
  visibility TEXT NOT NULL DEFAULT 'squad' CHECK (visibility IN ('squad', 'organization')),
  files TEXT NOT NULL CHECK (json_valid(files) AND json_type(files) = 'array'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  validated_revision INTEGER,
  validated_digest TEXT CHECK (
    validated_digest IS NULL
    OR (length(validated_digest) = 71 AND validated_digest GLOB 'sha256:*' AND substr(validated_digest, 8) NOT GLOB '*[^0-9a-f]*')
  ),
  validated_size_bytes INTEGER CHECK (validated_size_bytes IS NULL OR validated_size_bytes > 0),
  -- {name, version, description, components}: what the approval publishes.
  validated_manifest TEXT CHECK (validated_manifest IS NULL OR json_valid(validated_manifest)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- A validation is all four columns or none.
  CHECK ((validated_revision IS NULL) = (validated_digest IS NULL)),
  CHECK ((validated_digest IS NULL) = (validated_size_bytes IS NULL)),
  CHECK ((validated_digest IS NULL) = (validated_manifest IS NULL)),
  CHECK (validated_revision IS NULL OR validated_revision = revision)
) STRICT;

-- The author's drafts, newest first.
CREATE INDEX drafts_author_id ON drafts (author_id, created_at, id);
