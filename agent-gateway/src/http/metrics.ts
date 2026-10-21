import type { FastifyInstance } from "fastify";
import { collectDefaultMetrics, Counter, Histogram, Registry } from "@prometheus-io/client";

export interface GatewayMetrics {
  registry: Registry;
  toolCalls: Counter<"server" | "outcome">;
}

// One registry per server instance, so tests can build many servers in one process.
// Labels are bounded: route template, method, status, registered server name and outcome.
export function registerMetrics(app: FastifyInstance): GatewayMetrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  const duration = new Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route", "status_code"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [registry],
  });
  const toolCalls = new Counter({
    name: "gateway_tool_calls_total",
    help: "MCP tools/call requests by server and outcome (ok, denied, error)",
    labelNames: ["server", "outcome"],
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

  return { registry, toolCalls };
}
