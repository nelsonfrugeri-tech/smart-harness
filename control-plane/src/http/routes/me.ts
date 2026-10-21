import type { FastifyInstance } from "fastify";
import { authenticate, type AuthDeps } from "../auth.ts";

// Returns the caller and their memberships as stored right now.
// A user without memberships gets an empty list and sees no tenant data.
export function registerMeRoute(app: FastifyInstance, deps: AuthDeps): void {
  app.get("/v1/me", async (request) => {
    const { user, memberships } = await authenticate(request, deps);
    return { user, memberships };
  });
}
