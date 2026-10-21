import { createHash, randomBytes } from "node:crypto";

// Gateway token format: "shg_" + 32 random bytes in base64url (43 characters).
// The database stores only sha256(token) in lowercase hex, computed over the whole string,
// prefix included. The Agent Gateway (#13) applies the same format check, the same hash and
// the query in db/repos/gateway-tokens.ts (ACTIVE_GATEWAY_TOKEN_SQL).

export const GATEWAY_TOKEN_PREFIX = "shg_";
const TOKEN_BYTES = 32;
const GATEWAY_TOKEN_FORMAT = /^shg_[A-Za-z0-9_-]{43}$/;

export function generateGatewayToken(): { token: string; hash: string } {
  const token = GATEWAY_TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, hash: hashGatewayToken(token) };
}

export function hashGatewayToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// True when the bearer value claims to be a gateway token, well formed or not.
export function isGatewayTokenClaim(bearer: string): boolean {
  return bearer.startsWith(GATEWAY_TOKEN_PREFIX);
}

export function isWellFormedGatewayToken(bearer: string): boolean {
  return GATEWAY_TOKEN_FORMAT.test(bearer);
}
