import type { FastifyInstance, FastifyRequest } from "fastify";
import { errors as joseErrors, jwtVerify, SignJWT } from "jose";
import type { Db } from "../db/database.ts";
import { findActiveGatewayTokenUserId } from "../db/repos/gateway-tokens.ts";
import { findUserById, listMembershipsOfUser } from "../db/repos/identity.ts";
import { buildPrincipal, type Principal } from "../domain/access.ts";
import { hashGatewayToken, isGatewayTokenClaim, isWellFormedGatewayToken } from "../domain/gateway-token.ts";
import { unauthorized } from "./problem.ts";

// Two bearer credentials, both resolved to a user id:
// - the JWT from dev-login, accepted on every authenticated route;
// - the gateway token (shg_...), accepted only on routes registered with
//   `config: GATEWAY_TOKEN_ALLOWED`. Every other route answers 401 to it.
// The token is meant for reads. Its one write is PUT /v1/me/installations, where the CLI
// reports what it installed: it changes only the caller's own rows and touches no other user,
// permission or token, so a leaked token still cannot publish, pin, grant or mint credentials.
// Roles and tenants are read from the database on every request, so removing a membership
// takes effect on the next call.

declare module "fastify" {
  interface FastifyContextConfig {
    // true on the product reads the developer's tools call (/v1/me, workspace, Marketplace,
    // plugins, setup-plan and archive) and on exactly one write, PUT /v1/me/installations,
    // which alters only the caller's own state. Never on any other write nor on token management.
    gatewayToken?: boolean;
  }
}

export const GATEWAY_TOKEN_ALLOWED = { gatewayToken: true } as const;

const ISSUER = "smart-harness-control-plane";
const AUDIENCE = "smart-harness";
const ALGORITHM = "HS256";

export interface AuthDeps {
  db: Db;
  jwtSecret: Uint8Array;
}

export async function issueAccessToken(
  secret: Uint8Array,
  userId: string,
  ttlSeconds: number,
): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret);
}

// Refuses a gateway token before body parsing and validation, so a write answers 401 and
// not 400. Applies to every route, unknown ones included. authenticate() checks again.
export function registerGatewayTokenGuard(app: FastifyInstance): void {
  app.addHook("onRequest", async (request) => {
    const token = optionalBearerToken(request.headers.authorization);
    if (token !== undefined && isGatewayTokenClaim(token)) assertGatewayTokenAllowed(request);
  });
}

// Verifies the bearer token and loads the caller from the database. Throws a 401 problem.
export async function authenticate(request: FastifyRequest, deps: AuthDeps): Promise<Principal> {
  const token = bearerToken(request.headers.authorization);
  const userId = isGatewayTokenClaim(token)
    ? gatewayTokenUserId(request, token, deps.db)
    : await verifiedSubject(token, deps.jwtSecret);

  const user = findUserById(deps.db, userId);
  if (!user) {
    throw unauthorized("invalid_token", "token user no longer exists");
  }
  return buildPrincipal(user, listMembershipsOfUser(deps.db, user.id));
}

function bearerToken(header: string | undefined): string {
  const token = optionalBearerToken(header);
  if (token === undefined) {
    throw unauthorized("missing_token", "send Authorization: Bearer <access_token>");
  }
  return token;
}

function optionalBearerToken(header: string | undefined): string | undefined {
  return /^Bearer ([^\s]+)$/i.exec(header ?? "")?.[1];
}

function assertGatewayTokenAllowed(request: FastifyRequest): void {
  if (request.routeOptions.config?.gatewayToken !== true) {
    throw unauthorized("gateway_token_not_allowed", "this route requires the access token from login");
  }
}

function gatewayTokenUserId(request: FastifyRequest, token: string, db: Db): string {
  assertGatewayTokenAllowed(request);
  const userId = isWellFormedGatewayToken(token)
    ? findActiveGatewayTokenUserId(db, hashGatewayToken(token))
    : undefined;
  if (userId === undefined) {
    throw unauthorized("invalid_token", "gateway token is invalid, revoked or expired");
  }
  return userId;
}

async function verifiedSubject(token: string, secret: Uint8Array): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: [ALGORITHM],
    });
    if (typeof payload.sub !== "string" || payload.sub === "") {
      throw unauthorized("invalid_token", "token has no subject");
    }
    return payload.sub;
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) {
      throw unauthorized("invalid_token", "token expired");
    }
    if (error instanceof joseErrors.JOSEError) {
      throw unauthorized("invalid_token", "token is invalid");
    }
    throw error;
  }
}
