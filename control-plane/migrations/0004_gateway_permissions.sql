-- Gateway permissions: the resources (repositories, boards, pages) each project may reach
-- through each MCP server. The Agent Gateway reads this table on every tool call and denies
-- any resource that is not listed for the project, even inside the same squad.
-- resource_type is defined by the server: github=repo, trello=board, notion=page.

CREATE TABLE gateway_permissions (
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  server TEXT NOT NULL CHECK (length(server) BETWEEN 1 AND 64),
  resource_type TEXT NOT NULL CHECK (length(resource_type) BETWEEN 1 AND 64),
  resource_id TEXT NOT NULL CHECK (length(resource_id) BETWEEN 1 AND 200),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, server, resource_type, resource_id)
) STRICT;
