import { lstat, readdir, realpath, open } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { load, JSON_SCHEMA } from "js-yaml";

export interface ProjectDocument {
  id: string;
  title: string;
  source: string;
  content: string;
  metadata: Record<string, unknown>;
  truncated: boolean;
}

export class ProjectFiles {
  private readonly root: string;
  private readonly projects: Record<string, string>;

  constructor(root: string, projects: Record<string, string>) {
    this.root = root;
    this.projects = projects;
  }

  source(slug: string, path: string): string {
    return `examples/${this.projects[slug].replaceAll("\\", "/")}/${path}`;
  }

  async project(slug: string): Promise<string> {
    if (!Object.hasOwn(this.projects, slug)) throw new Error("Unknown project.");
    const mapping = this.projects[slug];
    if (mapping.length > 200 || isAbsolute(mapping) || mapping.split(/[\\/]/).includes("..")) throw new Error("Invalid project mapping.");
    const root = await realpath(this.root);
    const path = resolve(root, mapping);
    assertWithin(root, path);
    const canonical = await realpath(path);
    assertWithin(root, canonical);
    return canonical;
  }

  async read(project: string, path: string): Promise<string> {
    const resolved = resolve(project, path);
    assertWithin(project, resolved);
    const segments = relative(project, resolved).split(/[\\/]/);
    let current = project;
    for (const segment of segments) {
      current = resolve(current, segment);
      if ((await lstat(current)).isSymbolicLink()) throw new Error("Symbolic links are not supported.");
    }
    assertWithin(project, await realpath(resolved));
    const handle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      assertWithin(project, await realpath(resolved));
      const current = await lstat(resolved);
      if (current.isSymbolicLink() || current.dev !== stat.dev || current.ino !== stat.ino) throw new Error("Document changed during access.");
      if (!stat.isFile() || stat.size > 262144) throw new Error("Invalid document size or type.");
      const buffer = Buffer.alloc(262145);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 262144) throw new Error("Document is too large.");
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  }

  async documents(project: string, slug: string, category: string): Promise<ProjectDocument[]> {
    const directory = resolve(project, "docs", category);
    // Validate each directory component before enumerating it, including empty directories.
    for (const path of [resolve(project, "docs"), directory]) {
      if ((await lstat(path)).isSymbolicLink()) throw new Error("Symbolic links are not supported.");
      assertWithin(project, await realpath(path));
    }
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.length > 1000) throw new Error("Too many project documents.");
    const documents: ProjectDocument[] = [];
    for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (!entry.name.endsWith(".md")) continue;
      const path = `docs/${category}/${entry.name}`;
      const text = await this.read(project, path);
      const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(text);
      if (match === null) throw new Error("Missing document metadata.");
      const metadata = validateMetadata(load(match[1], { schema: JSON_SCHEMA }), category);
      const id = metadata.id as string;
      if (documents.some((document) => document.id === id)) throw new Error("Duplicate document id.");
      documents.push({ id, title: metadata.title as string, metadata, source: this.source(slug, path), content: match[2].trim(), truncated: false });
    }
    return documents;
  }
}

function assertWithin(root: string, path: string): void {
  const child = relative(root, path);
  if (!child || child === ".." || child.startsWith("../") || isAbsolute(child)) throw new Error("Invalid project path.");
}

function validateMetadata(value: unknown, category: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid metadata.");
  const data = value as Record<string, unknown>;
  const prefix = category === "adr" ? "ADR" : category === "backlog" ? "BL" : "DL";
  if (typeof data.id !== "string" || !new RegExp(`^${prefix}-[A-Za-z0-9-]{1,64}$`).test(data.id)
    || typeof data.title !== "string" || data.title.length === 0 || data.title.length > 500) throw new Error("Invalid document identity.");
  const result: Record<string, unknown> = { id: data.id, title: data.title };
  for (const field of ["status", "priority", "date", "delivered_at", "backlog_id"]) {
    if (data[field] === undefined) continue;
    if (typeof data[field] !== "string" || data[field].length > 200) throw new Error("Invalid document metadata field.");
    result[field] = data[field];
  }
  for (const field of ["labels", "tags", "related_decisions"]) {
    if (data[field] === undefined) continue;
    if (!Array.isArray(data[field]) || data[field].length > 100 || !data[field].every((item: unknown) => typeof item === "string" && item.length <= 200)) {
      throw new Error("Invalid document metadata list.");
    }
    result[field] = data[field];
  }
  return result;
}
