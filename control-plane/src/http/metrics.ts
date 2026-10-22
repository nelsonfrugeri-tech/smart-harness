import type { FastifyInstance } from "fastify";
import { collectDefaultMetrics, Histogram, Registry } from "@prometheus-io/client";

// One registry per server instance, so tests can build many servers in one process.
export function registerMetrics(app: FastifyInstance): Registry {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  // Labels are bounded: the route template (never the raw URL), the method and the status.
  const duration = new Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route", "status_code"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 240],
    registers: [registry],
  });

  app.addHook("onResponse", async (request, reply) => {
    duration.observe(
      {
        method: request.method,
        route: request.routeOptions.url ?? "unmatched",
        status_code: String(reply.statusCode),
      },
      reply.elapsedTime / 1000,
    );
  });

  return registry;
}
