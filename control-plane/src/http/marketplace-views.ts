// JSON shapes of the Marketplace responses (snake_case, as described in openapi.json).
import type { PluginEntry, VersionRecord } from "../db/repos/marketplace.ts";

export function archiveUrl(pluginName: string, version: string): string {
  return `/v1/plugins/${pluginName}/versions/${version}/archive`;
}

export function versionView(pluginName: string, version: VersionRecord) {
  return {
    version: version.version,
    visibility: version.visibility,
    description: version.description,
    digest: version.digest,
    size_bytes: version.sizeBytes,
    published_at: version.publishedAt,
    archive_url: archiveUrl(pluginName, version.version),
  };
}

// A plugin with its latest visible version: one Marketplace item, the plugin detail
// and one entry of the setup-plan.
export function pluginView(entry: PluginEntry) {
  return {
    plugin: { name: entry.pluginName, description: entry.version.description, tenant: entry.tenant },
    version: versionView(entry.pluginName, entry.version),
    type: entry.components.length > 0 && entry.components.every((item) => item.kind === "mcp")
      ? "connector"
      : entry.components.length > 0 && entry.components.every((item) => item.kind === "skill") ? "skill" : "agent",
    keywords: JSON.parse(entry.version.keywords) as string[],
    components: entry.components,
  };
}
