import type { McpBackend, ToolDefinition } from "../../mcp/backend.ts";
import { ProjectFiles } from "./documents.ts";
import { page, textResult, truncate } from "./response.ts";
import { parseManifest } from "./manifest.ts";

const PAGINATION = { limit: { type: "integer", minimum: 1, maximum: 100 }, cursor: { type: "string" } };
const TOOLS: Omit<ToolDefinition, "access">[] = [
  { name: "project_overview", description: "Reads the project's manifest and README overview.", inputSchema: { type: "object", properties: {} } },
  { name: "decisions_search", description: "Searches project decisions by text, with source paths.", inputSchema: { type: "object", properties: { query: { type: "string" }, ...PAGINATION }, required: ["query"] } },
  { name: "backlog_list", description: "Lists project backlog items, optionally filtered by status.", inputSchema: { type: "object", properties: { status: { type: "string" }, ...PAGINATION } } },
  { name: "backlog_get", description: "Reads a backlog item by its document id.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "delivered_list", description: "Lists project deliveries, with source paths.", inputSchema: { type: "object", properties: PAGINATION } },
];

export function createProjectBackend(options: { root: string; projects: Record<string, string> }): McpBackend {
  const files = new ProjectFiles(options.root, { ...options.projects });
  return {
    server: "project",
    listTools: (ctx) => TOOLS.map((tool) => ({ ...tool, access: { kind: "resource", resourceType: "project", extract: () => ctx.project.slug } })),
    async callTool(ctx, name, args) {
      try {
        if (!(ctx.allowedResources.project ?? []).includes(ctx.project.slug)) return textResult({ error: "Access denied." }, true);
        const definition = TOOLS.find((tool) => tool.name === name);
        if (!definition) throw new Error("Unknown tool.");
        validateArgs(definition, args);
        const project = await files.project(ctx.project.slug);
        if (name === "project_overview") {
          const manifest = { ...parseManifest(await files.read(project, "project.yaml")), source: files.source(ctx.project.slug, "project.yaml") };
          const source = files.source(ctx.project.slug, "README.md");
          const overview = { project: ctx.project.slug, id: manifest.id, manifest, source, sources: [manifest.source, source], content: await files.read(project, "README.md"), truncated: false };
          return textResult(truncate(overview, (value) => value));
        }
        const category = name === "decisions_search" ? "adr" : name === "delivered_list" ? "delivered" : "backlog";
        let documents = await files.documents(project, ctx.project.slug, category);
        if (name === "backlog_get") {
          if (typeof args.id !== "string" || !/^BL-[A-Za-z0-9-]{1,64}$/.test(args.id)) throw new Error("Invalid backlog id.");
          const document = documents.find((item) => item.id === args.id);
          if (!document) return textResult({ error: "Document not found." }, true);
          return textResult(truncate(document, (value) => value));
        }
        if (typeof args.query === "string") {
          const query = args.query.toLowerCase();
          documents = documents.filter((document) => `${document.id}\n${document.title}\n${JSON.stringify(document.metadata)}\n${document.content}`.toLowerCase().includes(query));
        }
        if (typeof args.status === "string") documents = documents.filter((document) => document.metadata.status === args.status);
        return page(documents, args, JSON.stringify([ctx.project.slug, name, args.query, args.status]));
      } catch {
        return textResult({ error: "Invalid request or project documents unavailable." }, true);
      }
    },
  };
}

function validateArgs(tool: Omit<ToolDefinition, "access">, args: Record<string, unknown>): void {
  const properties = tool.inputSchema.properties ?? {};
  for (const key of Object.keys(args)) {
    if (!Object.hasOwn(properties, key)) throw new Error("Unknown argument.");
    if (key !== "limit" && (typeof args[key] !== "string" || (args[key] as string).length > 1000)) throw new Error("Invalid argument.");
  }
  for (const key of tool.inputSchema.required ?? []) {
    if (typeof args[key] !== "string" || !(args[key] as string).trim()) throw new Error("Missing argument.");
  }
}
