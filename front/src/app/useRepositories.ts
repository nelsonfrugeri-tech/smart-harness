import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { api, ApiError, type GitHubRepository } from "../api/client";
interface RepositoryState {
  items: GitHubRepository[];
  cursor: string | null;
  loading: boolean;
  error?: ApiError;
}
async function requestRepositories(
  token: string,
  signal: AbortSignal,
  expire: () => void,
  setState: Dispatch<SetStateAction<RepositoryState>>,
  cursor?: string,
) {
  try {
    const page = await api.repositories(cursor, token, signal);
    if (signal.aborted) return;
    setState((previous) => {
      const items = new Map(
        (cursor ? previous.items : []).map((item) => [item.id, item]),
      );
      for (const item of page.items) items.set(item.id, item);
      return {
        items: [...items.values()],
        cursor: page.next_cursor,
        loading: false,
      };
    });
  } catch (failure) {
    if (signal.aborted) return;
    const issue =
      failure instanceof ApiError ? failure : new ApiError(0, "network_error");
    if (issue.status === 401) return expire();
    setState((previous) => ({ ...previous, loading: false, error: issue }));
  }
}
function loadingState(previous: RepositoryState): RepositoryState {
  return { ...previous, loading: true, error: undefined };
}
export function useRepositories(token: string, expire: () => void) {
  const [state, setState] = useState<RepositoryState>({
    items: [],
    cursor: null,
    loading: true,
  });
  const request = useRef<AbortController | null>(null);
  const load = useCallback(
    (cursor?: string) => {
      if (request.current && !request.current.signal.aborted) return;
      const controller = new AbortController();
      request.current = controller;
      setState((previous) => loadingState(previous));
      void requestRepositories(
        token,
        controller.signal,
        expire,
        setState,
        cursor,
      ).finally(() => {
        if (request.current === controller) request.current = null;
      });
    },
    [token, expire],
  );
  useEffect(() => {
    load();
    return () => request.current?.abort();
  }, [load]);
  return {
    state,
    update: (item: GitHubRepository) =>
      setState((previous) => ({
        ...previous,
        items: [
          ...previous.items.filter((entry) => entry.id !== item.id),
          item,
        ],
      })),
    more: () =>
      load(
        state.error?.code === "invalid_cursor"
          ? undefined
          : (state.cursor ?? undefined),
      ),
  };
}
