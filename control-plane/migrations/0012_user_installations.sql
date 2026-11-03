-- What each developer installed with the CLI, as last reported by `harness`. Both tables belong
-- to the user, never to a tenant, like gateway_tokens. The report header keeps the CLI version
-- and the time of the last report even when nothing is installed; the rows keep one version per
-- plugin.
CREATE TABLE user_installation_reports (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  cli_version TEXT NOT NULL CHECK (length(cli_version) BETWEEN 1 AND 50),
  reported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

-- installed_at is the first report that listed the plugin: a later report with another version
-- updates only version, and a plugin absent from a report is deleted.
CREATE TABLE user_installations (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  plugin_id TEXT NOT NULL REFERENCES plugins (id) ON DELETE CASCADE,
  version TEXT NOT NULL CHECK (length(version) BETWEEN 1 AND 100),
  installed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, plugin_id)
) STRICT;
