import { useSyncExternalStore } from "react";
function subscribe(callback: () => void) {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
}
export function navigate(path: string, replace = false) {
  if (replace) history.replaceState(null, "", path);
  else if (location.pathname !== path) history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
export function useRoute() {
  const path = useSyncExternalStore(subscribe, () => location.pathname);
  if (path === "/" || path === "/workspace")
    return { kind: "workspace" } as const;
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
