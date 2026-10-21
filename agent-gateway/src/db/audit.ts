import type { Db } from "./database.ts";

// Append-only audit trail in the control plane's audit_events table. The gateway writes straight
// to the shared SQLite file (WAL, busy_timeout) instead of calling an internal API endpoint:
// one writer path less to secure, and a gateway audit write does not depend on the API being up.

export type Outcome = "ok" | "denied" | "error";

export interface AuditEvent {
  action: "gateway.tool_call" | "gateway.access_denied";
  actorUserId: string;
  tenantId: string | null;
  correlationId: string;
  // Identifiers and outcomes only. Never tool arguments, results or error messages.
  details: Record<string, string | number | null>;
}

export interface AuditSink {
  record(event: AuditEvent): void;
}

export function createAuditSink(db: Db): AuditSink {
  const insert = db.prepare(
    `INSERT INTO audit_events (actor_user_id, tenant_id, action, correlation_id, details)
     VALUES (?, ?, ?, ?, ?)`,
  );
  return {
    record(event) {
      insert.run(event.actorUserId, event.tenantId, event.action, event.correlationId, JSON.stringify(event.details));
    },
  };
}
