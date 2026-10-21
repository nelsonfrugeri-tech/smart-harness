import { load, JSON_SCHEMA } from "js-yaml";

export interface ProjectManifest {
  id: string;
  name: string;
  summary: string;
  stack: string[];
  components: { name: string; path: string; summary: string }[];
}

export function parseManifest(text: string): ProjectManifest {
  const data = object(load(text, { schema: JSON_SCHEMA }));
  const id = string(data.id, 100);
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(id)) throw new Error("Invalid project id.");
  if (!Array.isArray(data.stack) || data.stack.length > 30 || !Array.isArray(data.components) || data.components.length > 30) {
    throw new Error("Invalid project collections.");
  }
  const manifest = {
    id, name: string(data.name, 200), summary: string(data.summary, 2000),
    stack: data.stack.map((item: unknown) => string(item, 200)),
    components: data.components.map((item: unknown) => {
      const component = object(item);
      return { name: string(component.name, 100), path: string(component.path, 300), summary: string(component.summary, 500) };
    }),
  };
  return manifest;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid project manifest.");
  return value as Record<string, unknown>;
}

function string(value: unknown, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Error("Invalid project manifest field.");
  return value;
}
