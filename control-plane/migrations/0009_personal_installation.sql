-- A presentation-only profile field; authorization continues to use memberships.role.
ALTER TABLE users ADD COLUMN job_title TEXT CHECK (job_title IS NULL OR length(job_title) BETWEEN 1 AND 120);

-- Explicit grants for a user's personal connectors. A current membership is still required
-- by every gateway query; removing membership never leaves an active permission behind.
CREATE TABLE user_gateway_permissions (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  server TEXT NOT NULL CHECK (length(server) BETWEEN 1 AND 64),
  resource_type TEXT NOT NULL CHECK (length(resource_type) BETWEEN 1 AND 64),
  resource_id TEXT NOT NULL CHECK (length(resource_id) BETWEEN 1 AND 200),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, tenant_id, server, resource_type, resource_id)
) STRICT;
