import { useEffect, useRef, type MouseEvent } from "react";
interface PendingFocus {
  trigger: HTMLButtonElement;
  names: Set<string>;
  query: string;
}
export function usePaginationFocus(
  names: string[],
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
    focusPage(results.current, request, names);
  }, [names, loading, query]);
  return {
    results,
    loadMore: (event?: MouseEvent<HTMLButtonElement>) => {
      if (loading) return;
      const trigger = event?.currentTarget ?? document.activeElement;
      if (trigger instanceof HTMLButtonElement)
        pending.current = {
          trigger,
          names: new Set(names),
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
  names: string[],
) {
  const active = document.activeElement;
  if (
    active !== request.trigger &&
    !(active === document.body && !request.trigger.isConnected)
  )
    return;
  const next = names.find((name) => !request.names.has(name));
  const links = results?.querySelectorAll<HTMLElement>("[data-page-item]");
  const nextLink =
    next &&
    Array.from(links ?? []).find((link) => link.dataset.pageItem === next);
  const target =
    nextLink ||
    results?.querySelector<HTMLElement>(
      ".pagination-error button, .result-end",
    );
  target?.focus();
}
