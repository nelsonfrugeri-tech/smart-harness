-- GitHub holds the archive; SQLite records the publication and its immutable origin.
CREATE TABLE github_repositories (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('squad', 'organization')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_synced_at TEXT,
  last_version_id INTEGER REFERENCES plugin_versions(id),
  UNIQUE(owner, repo)
) STRICT;
CREATE INDEX github_repositories_tenant ON github_repositories(tenant_id, id);

CREATE TABLE github_package_versions (
  version_id INTEGER PRIMARY KEY REFERENCES plugin_versions(id),
  repository_id TEXT NOT NULL REFERENCES github_repositories(id),
  tag TEXT NOT NULL,
  commit_sha TEXT NOT NULL CHECK (length(commit_sha) = 40),
  release_id INTEGER NOT NULL CHECK (release_id > 0),
  asset_id INTEGER NOT NULL CHECK (asset_id > 0),
  asset_name TEXT NOT NULL,
  UNIQUE(repository_id, tag)
) STRICT;
CREATE TRIGGER github_package_versions_no_update BEFORE UPDATE ON github_package_versions
BEGIN SELECT RAISE(ABORT, 'package origins are immutable'); END;
CREATE TRIGGER github_package_versions_no_delete BEFORE DELETE ON github_package_versions
BEGIN SELECT RAISE(ABORT, 'package origins are immutable'); END;
