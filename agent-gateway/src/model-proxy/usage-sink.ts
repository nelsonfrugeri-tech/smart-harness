import type { Db } from "../db/database.ts";
import type { Usage } from "./usage-tracker.ts";

export type ModelOutcome = "ok" | "upstream_error" | "stream_error" | "incomplete" | "unreachable";

export interface ModelUsageRecord {
  userId: string;
  tenantId: string | null;
  projectId: string | null;
  correlationId: string;
  harness: string;
  model: string | null;
  usage: Usage;
  httpStatus: number;
  outcome: ModelOutcome;
  durationMs: number;
}

export interface ModelUsageSink {
  record(entry: ModelUsageRecord): void;
}

// Appends to the control plane's model_usage table through the gateway's write connection.
// Only identifiers, counts and outcomes: never prompt or response text.
export function createModelUsageSink(db: Db): ModelUsageSink {
  const insert = db.prepare(
    `INSERT INTO model_usage (user_id, tenant_id, project_id, correlation_id, harness, model,
       input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens,
       http_status, outcome, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  return {
    record(entry) {
      insert.run(
        entry.userId,
        entry.tenantId,
        entry.projectId,
        entry.correlationId,
        entry.harness,
        entry.model,
        entry.usage.inputTokens,
        entry.usage.outputTokens,
        entry.usage.cacheCreationInputTokens,
        entry.usage.cacheReadInputTokens,
        entry.httpStatus,
        entry.outcome,
        entry.durationMs,
      );
    },
  };
}
