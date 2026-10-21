-- Marketplace: plugins owned by a squad, their immutable published versions, the components
-- of each version and the baseline package pinned per project.
-- The package archive lives in object storage under its digest; the database keeps
-- only the digest and the size, never the bytes.

-- A plugin belongs to one squad. Names are unique across the organization,
-- so /v1/plugins/{name} is unambiguous.
CREATE TABLE plugins (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants (id),
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX plugins_tenant_id ON plugins (tenant_id);

-- The integer id follows publication order: the highest id of a plugin is its latest version.
-- visibility applies to the published version: squad (owner squad only) or organization (everyone).
CREATE TABLE plugin_versions (
  id INTEGER PRIMARY KEY,
  plugin_id TEXT NOT NULL REFERENCES plugins (id),
  version TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'squad' CHECK (visibility IN ('squad', 'organization')),
  description TEXT NOT NULL DEFAULT '',
  digest TEXT NOT NULL CHECK (length(digest) = 71 AND digest GLOB 'sha256:*' AND substr(digest, 8) NOT GLOB '*[^0-9a-f]*'),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  published_by TEXT REFERENCES users (id),
  published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (plugin_id, version),
  UNIQUE (id, plugin_id)
) STRICT;

CREATE INDEX plugin_versions_visibility ON plugin_versions (visibility, plugin_id);

-- Agents, skills and MCP servers shipped by a version. Used by the kind filter and the search.
CREATE TABLE components (
  id INTEGER PRIMARY KEY,
  version_id INTEGER NOT NULL REFERENCES plugin_versions (id),
  kind TEXT NOT NULL CHECK (kind IN ('agent', 'skill', 'mcp')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  UNIQUE (version_id, kind, name)
) STRICT;

-- One pinned version per plugin in the project's baseline. The composite foreign key
-- guarantees that the pinned version belongs to that plugin. Rollback is pinning an older version.
CREATE TABLE project_baseline (
  project_id TEXT NOT NULL REFERENCES projects (id),
  plugin_id TEXT NOT NULL REFERENCES plugins (id),
  version_id INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, plugin_id),
  FOREIGN KEY (version_id, plugin_id) REFERENCES plugin_versions (id, plugin_id)
) STRICT;

-- Published versions and their components never change and are never deleted.
CREATE TRIGGER plugin_versions_no_update BEFORE UPDATE ON plugin_versions
BEGIN SELECT RAISE(ABORT, 'plugin versions are immutable'); END;

CREATE TRIGGER plugin_versions_no_delete BEFORE DELETE ON plugin_versions
BEGIN SELECT RAISE(ABORT, 'plugin versions are immutable'); END;

CREATE TRIGGER components_no_update BEFORE UPDATE ON components
BEGIN SELECT RAISE(ABORT, 'plugin versions are immutable'); END;

CREATE TRIGGER components_no_delete BEFORE DELETE ON components
BEGIN SELECT RAISE(ABORT, 'plugin versions are immutable'); END;
