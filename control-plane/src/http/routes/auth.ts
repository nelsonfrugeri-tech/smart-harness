import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/database.ts";
import { recordAuditEvent } from "../../db/repos/audit.ts";
import { findUserByEmail, listMembershipsOfUser } from "../../db/repos/identity.ts";
import { buildPrincipal } from "../../domain/access.ts";
import { issueAccessToken } from "../auth.ts";
import { unauthorized } from "../problem.ts";

export interface DevLoginDeps {
  db: Db;
  jwtSecret: Uint8Array;
  tokenTtlSeconds: number;
}

interface DevLoginBody {
  email: string;
}

// Local-only login: trusts the e-mail and issues a JWT. The server registers this
// route only when APP_ENV=local, so it does not exist in any other environment.
export function registerDevLoginRoute(app: FastifyInstance, deps: DevLoginDeps): void {
  app.post<{ Body: DevLoginBody }>(
    "/v1/auth/dev-login",
    {
      schema: {
        body: {
          type: "object",
          required: ["email"],
          additionalProperties: false,
          properties: { email: { type: "string", format: "email", maxLength: 254 } },
        },
      },
    },
    async (request) => {
      const email = request.body.email.toLowerCase();
      const user = findUserByEmail(deps.db, email);
      if (!user) {
        throw unauthorized("unknown_user", "no user with this e-mail; run make seed");
      }

      const principal = buildPrincipal(user, listMembershipsOfUser(deps.db, user.id));
      recordAuditEvent(deps.db, principal.scope, {
        action: "auth.dev_login",
        tenantId: null,
        correlationId: request.id,
      });

      return {
        access_token: await issueAccessToken(deps.jwtSecret, user.id, deps.tokenTtlSeconds),
        token_type: "Bearer",
        expires_in: deps.tokenTtlSeconds,
      };
    },
  );
}
