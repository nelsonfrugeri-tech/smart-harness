import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import type { McpBackend, ToolDefinition, ToolContext } from "../mcp/backend.ts";
import { pageOfList, reduceObject, type Item } from "../mcp/limits.ts";
import { jsonResult, ToolError, withToolErrors } from "../mcp/result.ts";
import { asArray, asRecord, asString } from "./rest.ts";

// The project's own context (ADRs, backlog, delivered work), read from <root>/<project slug>/.
// Layout (the examples/investimentos-api reference project):
//   project.yaml, README.md, docs/adr/*.md, docs/backlog/*.md, docs/delivered/*.md
// Each markdown file starts with a YAML front matter that has at least an id.
// The folder is the project slug, so the compose mount (./examples:/project-context) needs no mapping table.

export interface ProjectOptions {
  root: string;
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const DOC_ID = /^[A-Za-z0-9-]{1,40}$/;
const EXCERPT_CHARS = 200;

const CURSOR = { cursor: { type: "string", description: "next_cursor of the previous page" } };

// Every project tool reads the caller's own project, so none names an external resource.
function tool(name: string, description: string, properties: Record<string, unknown>, required?: string[]): ToolDefinition {
  return { name, description, inputSchema: { type: "object", properties, ...(required === undefined ? {} : { required }) }, access: { kind: "project" } };
}

const TOOLS: ToolDefinition[] = [
  tool("project_overview", "Name, stack, components and README of the project, authorized integration resources and the number of ADRs, backlog items and delivered items.", {}),
  tool("decisions_search", "Lists the project's ADRs whose title, tags or text contain the query (all ADRs when the query is empty).", {
    query: { type: "string" },
    ...CURSOR,
  }),
  tool("backlog_list", "Lists the backlog items, optionally by status (for example ready).", { status: { type: "string" }, ...CURSOR }),
  tool("backlog_get", "Reads one backlog item with its full text and acceptance criteria.", { id: { type: "string" } }, ["id"]),
  tool("delivered_list", "Lists what was delivered, each entry linked to its backlog item.", CURSOR),
];

export function projectBackend(options: ProjectOptions): McpBackend {
  return {
    server: "project",
    listTools: () => TOOLS,
    callTool: (ctx, name, args) =>
      withToolErrors(async () => {
        if (!SLUG.test(ctx.project.slug)) throw new ToolError("Project context not found.");
        const slug = ctx.project.slug;
        const dir = join(options.root, slug);
        const cursor = typeof args.cursor === "string" ? args.cursor : undefined;

        switch (name) {
          case "project_overview":
            return jsonResult(await overview(dir, slug, ctx.projectResources ?? {}));
          case "decisions_search": {
            const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
            const docs = (await readDocs(dir, slug, "adr")).filter((doc) => matches(doc, query));
            return jsonResult(pageOfList(docs.map((doc) => summary(doc, ["title", "status", "date", "tags"], query)), cursor));
          }
          case "backlog_list": {
            const status = typeof args.status === "string" ? args.status : undefined;
            const docs = (await readDocs(dir, slug, "backlog")).filter((doc) => status === undefined || doc.meta.status === status);
            return jsonResult(pageOfList(docs.map((doc) => summary(doc, ["title", "status", "priority", "labels"], "")), cursor));
          }
          case "backlog_get": {
            const id = typeof args.id === "string" && DOC_ID.test(args.id) ? args.id : null;
            const doc = id === null ? undefined : (await readDocs(dir, slug, "backlog")).find((candidate) => candidate.id === id);
            if (doc === undefined) throw new ToolError("Backlog item not found.");
            return jsonResult(reduceObject({ id: doc.id, source: doc.source, ...doc.meta, body: doc.body }));
          }
          case "delivered_list": {
            const docs = await readDocs(dir, slug, "delivered");
            return jsonResult(pageOfList(docs.map((doc) => summary(doc, ["title", "delivered_at", "backlog_id"], "")), cursor));
          }
          default:
            throw new ToolError(`Unknown tool ${name}.`);
        }
      }),
  };
}

interface Doc {
  id: string;
  source: string;
  meta: Record<string, unknown>;
  body: string;
}

async function overview(dir: string, slug: string, resources: NonNullable<ToolContext["projectResources"]>): Promise<Item> {
  const manifest = asRecord(parse(await readOrFail(join(dir, "project.yaml"))));
  const readme = await readFile(join(dir, "README.md"), "utf8").catch(() => "");
  const count = async (folder: string) => (await readDocs(dir, slug, folder)).length;
  return reduceObject({
    id: slug,
    source: `${slug}/project.yaml`,
    name: asString(manifest.name),
    summary: asString(manifest.summary),
    resources,
    stack: asArray(manifest.stack),
    components: asArray(manifest.components),
    counts: { decisions: await count("adr"), backlog: await count("backlog"), delivered: await count("delivered") },
    readme,
  });
}

async function readOrFail(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    throw new ToolError("Project context not found.");
  }
}

// The documents of docs/<folder>, ordered by id. Files without a front matter id are skipped.
async function readDocs(dir: string, slug: string, folder: string): Promise<Doc[]> {
  let names: string[];
  try {
    names = (await readdir(join(dir, "docs", folder))).filter((name) => name.endsWith(".md"));
  } catch {
    throw new ToolError("Project context not found.");
  }
  const docs: Doc[] = [];
  for (const name of names) {
    const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(await readFile(join(dir, "docs", folder, name), "utf8"));
    const meta = asRecord(match?.[1] === undefined ? undefined : parse(match[1]));
    const id = asString(meta.id);
    if (match?.[2] !== undefined && id !== "") {
      const fields = { ...meta };
      delete fields.id;
      docs.push({ id, source: `${slug}/docs/${folder}/${name}`, meta: fields, body: match[2].trim() });
    }
  }
  return docs.sort((a, b) => a.id.localeCompare(b.id));
}

function matches(doc: Doc, query: string): boolean {
  if (query === "") return true;
  const haystack = [asString(doc.meta.title), asArray(doc.meta.tags).join(" "), doc.body].join("\n").toLowerCase();
  return haystack.includes(query);
}

function summary(doc: Doc, fields: string[], query: string): Item {
  const item: Item = { id: doc.id, source: doc.source };
  for (const field of fields) item[field] = doc.meta[field] ?? null;
  if (query !== "") item.excerpt = excerptAround(doc.body, query);
  return item;
}

// A short piece of the text around the first match; the start of the text when only the title matched.
function excerptAround(body: string, query: string): string {
  const flat = body.replace(/\s+/g, " ");
  const at = flat.toLowerCase().indexOf(query);
  const from = Math.max(0, at - EXCERPT_CHARS / 2);
  return flat.slice(at === -1 ? 0 : from, (at === -1 ? 0 : from) + EXCERPT_CHARS);
}
