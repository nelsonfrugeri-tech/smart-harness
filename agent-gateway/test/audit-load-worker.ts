// Child process of audit-concurrency.test.ts: appends audit events to the shared SQLite file,
// either the way the API does or the way the gateway does.
// Usage: node test/audit-load-worker.ts <api|gateway> <database path> <number of writes>
import { openDatabase } from "../../control-plane/src/db/database.ts";
import { recordAuditEvent } from "../../control-plane/src/db/repos/audit.ts";
import { createAuditSink } from "../src/db/audit.ts";
import { openAuditDatabase } from "../src/db/database.ts";

const [writer, path, count] = process.argv.slice(2);
if ((writer !== "api" && writer !== "gateway") || path === undefined || count === undefined) {
  console.error("usage: audit-load-worker.ts <api|gateway> <database path> <count>");
  process.exit(2);
}

const total = Number(count);
if (writer === "api") {
  const db = openDatabase(path);
  const scope = { userId: "load-api", tenantIds: [] };
  for (let i = 0; i < total; i++) {
    recordAuditEvent(db, scope, { action: "load.api", tenantId: null, correlationId: `api-${i}`, details: { i } });
  }
  db.close();
} else {
  const db = openAuditDatabase(path);
  const sink = createAuditSink(db);
  for (let i = 0; i < total; i++) {
    sink.record({ action: "gateway.tool_call", actorUserId: "load-gateway", tenantId: null, correlationId: `gw-${i}`, details: { i } });
  }
  db.close();
}
