import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Outcome } from "../db/audit.ts";
import type { McpBackend, ToolAccess, ToolContext, ToolDefinition } from "./backend.ts";
import { errorResult } from "./result.ts";

// Decides whether a tools/call may reach the backend, and runs it when it may.
// The result carries only what the audit trail may store: no argument values besides the resource id.

export interface ToolCallOutcome {
  result: CallToolResult;
  outcome: Outcome;
  reason: string | null;
  resourceType: string | null;
  resourceId: string | null;
  resourceCount: number | null;
}

const MAX_RESOURCE_ID_LENGTH = 200;

export async function executeToolCall(
  backend: McpBackend,
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallOutcome> {
  const tools = await discoverTools(backend, ctx);
  if (tools === null) {
    return {
      result: errorResult("The tool catalog is unavailable."),
      outcome: "error",
      reason: "catalog_unavailable",
      resourceType: null,
      resourceId: null,
      resourceCount: null,
    };
  }
  const tool = tools.find((candidate) => candidate.name === name);
  if (tool?.access === undefined) {
    return denied("tool_not_declared", null, null);
  }
  const { access } = tool;

  if (access.kind === "project") {
    return run(backend, ctx, name, args, { resourceType: "project", resourceId: ctx.project.slug, resourceCount: null });
  }

  const allowed = ctx.allowedResources[access.resourceType] ?? [];
  if (access.kind === "search") {
    if (allowed.length === 0) {
      return denied("no_allowed_resources", access.resourceType, null);
    }
    return run(backend, ctx, name, args, { resourceType: access.resourceType, resourceId: null, resourceCount: allowed.length });
  }

  const resourceId = extractResourceId(access, args);
  if (resourceId === null) {
    return denied("resource_not_identified", access.resourceType, null);
  }
  if (!allowed.includes(resourceId)) {
    return denied("resource_not_allowed", access.resourceType, resourceId);
  }
  return run(backend, ctx, name, args, { resourceType: access.resourceType, resourceId, resourceCount: null });
}

// Null when the catalog cannot be read. The error text is dropped: it may contain internal details.
export async function discoverTools(backend: McpBackend, ctx: ToolContext): Promise<ToolDefinition[] | null> {
  try {
    return await backend.listTools(ctx);
  } catch {
    return null;
  }
}

function extractResourceId(access: Extract<ToolAccess, { kind: "resource" }>, args: Record<string, unknown>): string | null {
  try {
    const id = access.extract(args);
    return typeof id === "string" && id !== "" ? id : null;
  } catch {
    return null;
  }
}

type Resource = Pick<ToolCallOutcome, "resourceType" | "resourceId" | "resourceCount">;

async function run(
  backend: McpBackend,
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>,
  resource: Resource,
): Promise<ToolCallOutcome> {
  try {
    const result = await backend.callTool(ctx, name, args);
    const failed = result.isError === true;
    return { result, outcome: failed ? "error" : "ok", reason: failed ? "tool_error" : null, ...resource };
  } catch {
    // The error text is not forwarded or stored: it may contain argument values.
    return {
      result: errorResult("The backend failed to run the tool."),
      outcome: "error",
      reason: "backend_error",
      ...resource,
    };
  }
}

function denied(reason: string, resourceType: string | null, resourceId: string | null): ToolCallOutcome {
  return {
    result: errorResult("Access denied: the tool or resource is not allowed for this project."),
    outcome: "denied",
    reason,
    resourceType,
    resourceId: resourceId === null ? null : resourceId.slice(0, MAX_RESOURCE_ID_LENGTH),
    resourceCount: null,
  };
}
