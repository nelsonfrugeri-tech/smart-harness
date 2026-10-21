import { createHash } from "node:crypto";

// Same format and hash as control-plane/src/domain/gateway-token.ts: "shg_" + 43 base64url
// characters, stored as the lowercase hex sha256 of the whole string, prefix included.
// The gateway only validates tokens; the API creates them.

const GATEWAY_TOKEN_FORMAT = /^shg_[A-Za-z0-9_-]{43}$/;

export function hashGatewayToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isWellFormedGatewayToken(bearer: string): boolean {
  return GATEWAY_TOKEN_FORMAT.test(bearer);
}
