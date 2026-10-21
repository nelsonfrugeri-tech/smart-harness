import type { Db } from "../database.ts";
import type { Scope } from "../../domain/access.ts";

export interface AuditEvent {
  action: string;
  // null for events that do not belong to a tenant, such as a login.
  tenantId: string | null;
  correlationId: string;
  details?: Record<string, unknown>;
}

// Records an event performed by the scope's user. A tenant event outside the scope is refused.
export function recordAuditEvent(db: Db, scope: Scope, event: AuditEvent): void {
  if (event.tenantId !== null && !scope.tenantIds.includes(event.tenantId)) {
    throw new Error(`tenant ${event.tenantId} is outside the caller's scope`);
  }
  db.prepare(
    `INSERT INTO audit_events (actor_user_id, tenant_id, action, correlation_id, details)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    scope.userId,
    event.tenantId,
    event.action,
    event.correlationId,
    JSON.stringify(event.details ?? {}),
  );
}
