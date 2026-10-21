import type { MarketplaceQuery } from "../api/client";
export type MarketplaceFilters = Omit<MarketplaceQuery, "cursor">;
export function readMarketplaceFilters(
  search: string,
): MarketplaceFilters | null {
  const params = new URLSearchParams(search);
  const kind = params.get("kind") || undefined;
  const project = params.get("project") || undefined;
  const q = params.get("q")?.trim() || undefined;
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (
    (kind && kind !== "agent" && kind !== "skill" && kind !== "mcp") ||
    (project && project.length > 100) ||
    (q && q.length > 100) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    return null;
  return { kind: kind as MarketplaceFilters["kind"], project, q, limit };
}
export function marketplaceSearch(filters: MarketplaceFilters) {
  const params = new URLSearchParams();
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.project) params.set("project", filters.project);
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  if (filters.limit && filters.limit !== 20)
    params.set("limit", String(filters.limit));
  const query = params.toString();
  return query ? `?${query}` : "";
}
export function marketplacePath(filters: MarketplaceFilters = {}) {
  return `/marketplace${marketplaceSearch(filters)}`;
}
export function packagePath(name: string, filters: MarketplaceFilters) {
  return `/marketplace/packages/${encodeURIComponent(name)}${marketplaceSearch(filters)}`;
}
