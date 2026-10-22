import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { api, ApiError, type PluginItem, type PluginPage } from "../api/client";
import { type MarketplaceFilters, marketplaceSearch } from "./marketplaceQuery";
interface PageState {
  query: string;
  items: PluginItem[];
  cursor: string | null;
  loading: boolean;
  error?: ApiError;
}
function initialState(query: string): PageState {
  return { query, items: [], cursor: null, loading: true };
}
function mergePage(
  previous: PageState,
  page: PluginPage,
  query: string,
  append: boolean,
): PageState {
  const items = new Map(
    (append ? previous.items : []).map((item) => [item.plugin.name, item]),
  );
  for (const item of page.items) items.set(item.plugin.name, item);
  return {
    query,
    items: [...items.values()],
    cursor: page.next_cursor,
    loading: false,
  };
}
async function requestPage(
  query: string,
  token: string,
  signal: AbortSignal,
  setState: Dispatch<SetStateAction<PageState>>,
  expire: () => void,
  cursor?: string,
) {
  const params = Object.fromEntries(new URLSearchParams(query));
  try {
    const page = await api.marketplace(
      { ...params, limit: params.limit ? Number(params.limit) : 20, cursor },
      token,
      signal,
    );
    if (!signal.aborted)
      setState((previous) =>
        mergePage(previous, page, query, cursor !== undefined),
      );
  } catch (error) {
    if (signal.aborted) return;
    if (error instanceof ApiError && error.status === 401) {
      expire();
      return;
    }
    setState((previous) => ({
      ...previous,
      loading: false,
      error:
        error instanceof ApiError ? error : new ApiError(0, "network_error"),
    }));
  }
}
export function useMarketplace(
  filters: MarketplaceFilters,
  token: string,
  expire: () => void,
) {
  const query = marketplaceSearch(filters);
  const [state, setState] = useState<PageState>(() => initialState(query));
  const request = useRef<AbortController | null>(null);
  const load = useCallback(
    (cursor?: string) => {
      if (request.current && !request.current.signal.aborted) return;
      const controller = new AbortController();
      request.current = controller;
      setState((previous) =>
        cursor
          ? { ...previous, loading: true, error: undefined }
          : initialState(query),
      );
      void requestPage(
        query,
        token,
        controller.signal,
        setState,
        expire,
        cursor,
      ).finally(() => {
        if (request.current === controller) request.current = null;
      });
    },
    [query, token, expire],
  );
  useEffect(() => {
    load();
    return () => {
      request.current?.abort();
    };
  }, [load]);
  return {
    state: state.query === query ? state : initialState(query),
    more: () => load(state.cursor ?? undefined),
    restart: () => {
      request.current?.abort();
      load();
    },
  };
}
