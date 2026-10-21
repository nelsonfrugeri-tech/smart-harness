import type { FastifyRequest } from "fastify";
import { errors as joseErrors, jwtVerify, SignJWT } from "jose";
import type { Db } from "../db/database.ts";
import { findUserById, listMembershipsOfUser } from "../db/repos/identity.ts";
import { buildPrincipal, type Principal } from "../domain/access.ts";
import { unauthorized } from "./problem.ts";

// The JWT only carries the user id. Roles and tenants are read from the database
// on every request, so removing a membership takes effect on the next call.

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

// Verifies the bearer token and loads the caller from the database. Throws a 401 problem.
export async function authenticate(request: FastifyRequest, deps: AuthDeps): Promise<Principal> {
  const token = bearerToken(request.headers.authorization);
  const userId = await verifiedSubject(token, deps.jwtSecret);

  const user = findUserById(deps.db, userId);
  if (!user) {
    throw unauthorized("invalid_token", "token user no longer exists");
  }
  return buildPrincipal(user, listMembershipsOfUser(deps.db, user.id));
}

function bearerToken(header: string | undefined): string {
  const match = /^Bearer ([^\s]+)$/i.exec(header ?? "");
  if (!match) {
    throw unauthorized("missing_token", "send Authorization: Bearer <access_token>");
  }
  return match[1];
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
