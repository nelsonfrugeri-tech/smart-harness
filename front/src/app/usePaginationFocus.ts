import { useEffect, useRef, type MouseEvent } from "react";
import type { PluginItem } from "../api/client";
interface PendingFocus {
  trigger: HTMLButtonElement;
  names: Set<string>;
  query: string;
}
export function usePaginationFocus(
  items: PluginItem[],
  loading: boolean,
  query: string,
  more: () => void,
) {
  const results = useRef<HTMLDivElement>(null);
  const pending = useRef<PendingFocus | null>(null);
  useEffect(() => {
    if (loading) return;
    const request = pending.current;
    pending.current = null;
    if (!request || request.query !== query) return;
    focusPage(results.current, request, items);
  }, [items, loading, query]);
  return {
    results,
    loadMore: (event?: MouseEvent<HTMLButtonElement>) => {
      if (loading) return;
      const trigger = event?.currentTarget ?? document.activeElement;
      if (trigger instanceof HTMLButtonElement)
        pending.current = {
          trigger,
          names: new Set(items.map((item) => item.plugin.name)),
          query,
        };
      more();
    },
    cancelFocus: () => {
      pending.current = null;
    },
  };
}

function focusPage(
  results: HTMLDivElement | null,
  request: PendingFocus,
  items: PluginItem[],
) {
  const active = document.activeElement;
  if (
    active !== request.trigger &&
    !(active === document.body && !request.trigger.isConnected)
  )
    return;
  const next = items.find((item) => !request.names.has(item.plugin.name));
  const links = results?.querySelectorAll<HTMLAnchorElement>(
    "a[data-package-name]",
  );
  const nextLink =
    next &&
    Array.from(links ?? []).find(
      (link) => link.dataset.packageName === next.plugin.name,
    );
  const target =
    nextLink ||
    results?.querySelector<HTMLElement>(
      ".pagination-error button, .result-end",
    );
  target?.focus();
}
