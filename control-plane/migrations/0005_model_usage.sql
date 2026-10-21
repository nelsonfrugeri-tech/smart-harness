-- Model usage: one row per request that the Agent Gateway forwards to the model provider.
-- The gateway appends the rows (it never reads them back); the API and reports read them.
-- Token columns are NULL when the provider did not report them (error before the first usage event).
-- Prompt and response text are never stored. user_id, tenant_id and project_id are plain text
-- without foreign keys, like audit_events: the history outlives the user or the project.

CREATE TABLE model_usage (
  id INTEGER PRIMARY KEY,
  -- When the row was written, that is, when the request ended.
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  user_id TEXT NOT NULL,
  tenant_id TEXT,
  -- Only when the caller names a project of its own squad.
  project_id TEXT,
  correlation_id TEXT NOT NULL,
  -- The coding agent that made the call, for example claude-code.
  harness TEXT NOT NULL CHECK (length(harness) BETWEEN 1 AND 64),
  model TEXT CHECK (model IS NULL OR length(model) BETWEEN 1 AND 200),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cache_creation_input_tokens INTEGER CHECK (cache_creation_input_tokens IS NULL OR cache_creation_input_tokens >= 0),
  cache_read_input_tokens INTEGER CHECK (cache_read_input_tokens IS NULL OR cache_read_input_tokens >= 0),
  -- HTTP status the gateway answered. A stream that fails after the headers still has 200.
  http_status INTEGER NOT NULL,
  -- ok: the response finished. upstream_error: the provider answered a non-2xx status.
  -- stream_error: an SSE error event arrived. incomplete: the stream ended without message_stop
  -- or the connection broke. unreachable: no response from the provider.
  outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'upstream_error', 'stream_error', 'incomplete', 'unreachable')),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0)
) STRICT;

CREATE INDEX model_usage_user_id ON model_usage (user_id, occurred_at);
CREATE INDEX model_usage_tenant_id ON model_usage (tenant_id, occurred_at);
