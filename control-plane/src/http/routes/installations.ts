import type { FastifyInstance } from "fastify";
import { listInstallations, replaceInstallations } from "../../db/repos/installations.ts";
import { CLI_VERSION_MAX_LENGTH, MAX_REPORTED_PLUGINS, type InstallationReport } from "../../domain/installations.ts";
import { PLUGIN_NAME_PATTERN, VERSION_PATTERN } from "../../domain/marketplace.ts";
import { authenticate, GATEWAY_TOKEN_ALLOWED, type AuthDeps } from "../auth.ts";

// What the caller installed with the CLI. `harness` reports the whole set with its gateway
// token; the front reads it with the JWT to mark Marketplace packages as installed.
export function registerInstallationRoutes(app: FastifyInstance, deps: AuthDeps): void {
  // The one write open to the gateway token (see auth.ts): it changes only the caller's own
  // rows and grants nothing. Answers 204 even when every name was ignored; the ignored names
  // go to the log, because the body carries no result.
  app.put<{ Body: InstallationReport }>(
    "/v1/me/installations",
    {
      config: GATEWAY_TOKEN_ALLOWED,
      schema: {
        body: {
          type: "object",
          required: ["cliVersion", "plugins"],
          additionalProperties: false,
          properties: {
            cliVersion: { type: "string", minLength: 1, maxLength: CLI_VERSION_MAX_LENGTH },
            plugins: {
              type: "array",
              maxItems: MAX_REPORTED_PLUGINS,
              items: {
                type: "object",
                required: ["name", "version"],
                additionalProperties: false,
                properties: {
                  name: { type: "string", pattern: PLUGIN_NAME_PATTERN },
                  version: { type: "string", pattern: VERSION_PATTERN },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { scope } = await authenticate(request, deps);
      const { ignored } = replaceInstallations(deps.db, scope, request.body);
      if (ignored.length > 0) {
        request.log.info({ ignored }, "installation report named plugins outside the caller's catalog");
      }
      return reply.code(204).send();
    },
  );

  // JWT only, like every new route: the front reads it and the CLI has no use for it, so the
  // gateway token answers 401 here.
  app.get("/v1/me/installations", async (request) => {
    const { scope } = await authenticate(request, deps);
    return listInstallations(deps.db, scope.userId);
  });
}
