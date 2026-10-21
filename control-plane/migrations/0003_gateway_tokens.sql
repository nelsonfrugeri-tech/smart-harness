-- Gateway tokens: the one secret a developer configures for MCPs, models and the harness CLI.
-- Only the sha256 of the token is stored; the value is shown once, when it is created.
-- A token is active while revoked_at IS NULL and expires_at is in the future.

CREATE TABLE gateway_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  -- Lowercase hex sha256 of the full token string, prefix included.
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  CHECK (expires_at > created_at)
) STRICT;

-- The owner's token list, newest first.
CREATE INDEX gateway_tokens_user_id ON gateway_tokens (user_id, created_at, id);
