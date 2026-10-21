import { useSyncExternalStore } from "react";
import { readMarketplaceFilters } from "./marketplaceQuery";
function subscribe(callback: () => void) {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
}
export function navigate(path: string, replace = false) {
  if (replace) history.replaceState(null, "", path);
  else if (location.pathname + location.search + location.hash !== path)
    history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
export function useRoute() {
  const url = useSyncExternalStore(
    subscribe,
    () => location.pathname + location.search + location.hash,
  );
  const { pathname: path, search } = new URL(url, location.origin);
  if (path === "/profile/tokens")
    return {
      kind: "tokens",
      project: new URLSearchParams(search).get("project"),
    } as const;
  if (path === "/marketplace" || path.startsWith("/marketplace/packages/")) {
    const filters = readMarketplaceFilters(search);
    if (!filters) return { kind: "invalid-marketplace" } as const;
    if (path === "/marketplace")
      return { kind: "marketplace", filters } as const;
    const packageMatch = /^\/marketplace\/packages\/([^/]+)\/?$/.exec(path);
    try {
      if (packageMatch)
        return {
          kind: "package",
          name: decodeURIComponent(packageMatch[1]),
          filters,
        } as const;
    } catch {
      /* Malformed paths remain unavailable. */
    }
  }
  if (path === "/" || path === "/workspace")
    return { kind: "workspace" } as const;
  const baseline = readBaselineRoute(path);
  if (baseline) return baseline;
  const match = /^\/workspace\/projects\/([^/]+)\/?$/.exec(path);
  try {
    if (match)
      return { kind: "project", slug: decodeURIComponent(match[1]) } as const;
  } catch {
    /* Malformed paths use the same unavailable state. */
  }
  return { kind: "missing" } as const;
}
export function projectPath(slug: string) {
  return `/workspace/projects/${encodeURIComponent(slug)}`;
}

function readBaselineRoute(path: string) {
  const match =
    /^\/workspace\/projects\/([^/]+)\/packages\/([^/]+)\/versions\/([^/]+)\/?$/.exec(
      path,
    );
  try {
    if (match)
      return {
        kind: "baseline-package",
        slug: decodeURIComponent(match[1]),
        name: decodeURIComponent(match[2]),
        version: decodeURIComponent(match[3]),
      } as const;
  } catch {
    /* Malformed paths remain unavailable. */
  }
}
export function baselinePackagePath(
  slug: string,
  name: string,
  version: string,
) {
  return `${projectPath(slug)}/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`;
}
