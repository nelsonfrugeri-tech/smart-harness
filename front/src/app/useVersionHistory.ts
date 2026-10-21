import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  api,
  ApiError,
  type PluginVersion,
  type VersionPage,
} from "../api/client";
interface HistoryState {
  items: PluginVersion[];
  cursor: string | null;
  loading: boolean;
  error?: ApiError;
}
const empty: HistoryState = { items: [], cursor: null, loading: true };
export function useVersionHistory(
  name: string,
  limit: number,
  token: string,
  expire: () => void,
) {
  const [state, setState] = useState<HistoryState>(empty);
  const [page, setPage] = useState<{ cursor?: string; attempt: number }>({
    attempt: 0,
  });
  const pending = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    pending.current = true;
    api
      .versions(name, limit, page.cursor, token, controller.signal)
      .then(
        (result) => {
          if (controller.signal.aborted) return;
          setState((previous) =>
            mergeVersions(previous, result, Boolean(page.cursor)),
          );
        },
        (error) =>
          reportHistoryError(error, controller.signal, expire, setState),
      )
      .finally(() => {
        if (!controller.signal.aborted) pending.current = false;
      });
    return () => controller.abort();
  }, [name, limit, token, expire, page]);
  const load = (cursor?: string) => {
    if (pending.current) return;
    pending.current = true;
    setState((previous) =>
      cursor ? { ...previous, loading: true, error: undefined } : empty,
    );
    setPage((previous) => ({ cursor, attempt: previous.attempt + 1 }));
  };
  return {
    state,
    more: () => load(state.cursor ?? undefined),
    restart: () => load(),
  };
}

function mergeVersions(
  previous: HistoryState,
  page: VersionPage,
  append: boolean,
): HistoryState {
  const items = new Map(
    (append ? previous.items : []).map((item) => [item.version, item]),
  );
  for (const item of page.items)
    if (!items.has(item.version)) items.set(item.version, item);
  return {
    items: [...items.values()],
    cursor: page.next_cursor,
    loading: false,
  };
}

function reportHistoryError(
  error: unknown,
  signal: AbortSignal,
  expire: () => void,
  setState: Dispatch<SetStateAction<HistoryState>>,
) {
  if (signal.aborted) return;
  if (error instanceof ApiError && error.status === 401) {
    expire();
    return;
  }
  setState((previous) => ({
    ...previous,
    loading: false,
    error: error instanceof ApiError ? error : new ApiError(0, "network_error"),
  }));
}
