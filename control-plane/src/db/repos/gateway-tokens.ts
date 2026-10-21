import { randomUUID } from "node:crypto";
import type { Db } from "../database.ts";

// Gateway tokens belong to a user, not to a tenant: every function filters by the owner's
// user id, like repos/identity.ts. No function reads or returns token_hash except the lookup
// used to authenticate.

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

// The validation rule, shared with the Agent Gateway (#13): a token is valid when its hash
// exists, it is not revoked and it has not expired. Bind sha256(token) in lowercase hex.
export const ACTIVE_GATEWAY_TOKEN_SQL = `SELECT user_id FROM gateway_tokens
  WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ${NOW}`;

export interface GatewayTokenRecord {
  id: string;
  name: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export function findActiveGatewayTokenUserId(db: Db, tokenHash: string): string | undefined {
  const row = db.prepare(ACTIVE_GATEWAY_TOKEN_SQL).get(tokenHash) as { user_id: string } | undefined;
  return row?.user_id;
}

export function insertGatewayToken(
  db: Db,
  token: { userId: string; name: string; tokenHash: string; ttlDays: number },
): GatewayTokenRecord {
  return db
    .prepare(
      `INSERT INTO gateway_tokens (id, user_id, name, token_hash, expires_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+' || ? || ' days'))
       RETURNING id, name, created_at, expires_at, revoked_at`,
    )
    .get(randomUUID(), token.userId, token.name, token.tokenHash, token.ttlDays) as GatewayTokenRecord;
}

// The owner's tokens, newest first, including revoked and expired ones.
// `after` is the (created_at, id) of the last row of the previous page.
export function listGatewayTokens(
  db: Db,
  userId: string,
  page: { after?: { createdAt: string; id: string }; limit: number },
): GatewayTokenRecord[] {
  const after = page.after ?? null;
  return db
    .prepare(
      `SELECT id, name, created_at, expires_at, revoked_at
         FROM gateway_tokens
        WHERE user_id = ?
          AND (? IS NULL OR (created_at, id) < (?, ?))
        ORDER BY created_at DESC, id DESC
        LIMIT ?`,
    )
    .all(userId, after?.createdAt ?? null, after?.createdAt ?? null, after?.id ?? null, page.limit) as GatewayTokenRecord[];
}

export type RevokeResult = "revoked" | "already_revoked" | "not_found";

// Revokes one of the owner's tokens. A token of another user is "not_found", like a missing one.
export function revokeGatewayToken(db: Db, userId: string, id: string): RevokeResult {
  const { changes } = db
    .prepare(`UPDATE gateway_tokens SET revoked_at = ${NOW} WHERE id = ? AND user_id = ? AND revoked_at IS NULL`)
    .run(id, userId);
  if (changes === 1) return "revoked";
  const exists = db.prepare("SELECT 1 FROM gateway_tokens WHERE id = ? AND user_id = ?").get(id, userId);
  return exists ? "already_revoked" : "not_found";
}
