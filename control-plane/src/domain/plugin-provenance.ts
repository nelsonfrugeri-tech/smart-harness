export interface PluginSource {
  kind: "open-source" | "internal";
  repository_url?: string;
  license?: string;
}

export interface RelatedProject extends PluginSource {
  name: string;
  repository_url: string;
}

export interface PluginProvenance {
  source?: PluginSource;
  related_project?: RelatedProject;
}

// Repository roots only: no credentials, non-HTTPS schemes, ports, query strings or fragments.
export function isGitHubRepository(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9_.-]{1,100})$/.exec(value);
  return match !== null && match[2] !== "." && match[2] !== "..";
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function label(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 120;
}

function source(value: unknown): PluginSource | undefined {
  const item = record(value);
  if (item.kind !== "open-source" && item.kind !== "internal") return undefined;
  if (item.repository_url !== undefined && !isGitHubRepository(item.repository_url)) return undefined;
  if (item.license !== undefined && !label(item.license)) return undefined;
  return { kind: item.kind,
    ...(typeof item.repository_url === "string" ? { repository_url: item.repository_url } : {}),
    ...(typeof item.license === "string" ? { license: item.license } : {}) };
}

// Whitelist again on reads so malformed legacy/editorial data never produces unsafe links.
export function readPluginProvenance(json: string): PluginProvenance {
  let data: Record<string, unknown>;
  try { data = record(JSON.parse(json)); } catch { return {}; }
  const origin = source(data.source);
  const related = record(data.related_project);
  const relatedSource = source(related);
  return {
    ...(origin ? { source: origin } : {}),
    ...(relatedSource && label(related.name) && isGitHubRepository(related.repository_url)
      ? { related_project: { ...relatedSource, name: related.name, repository_url: related.repository_url } } : {}),
  };
}
