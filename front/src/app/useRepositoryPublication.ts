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
  type GitHubRepository,
  type RepositoryRegistration,
  type RepositorySync,
} from "../api/client";
import { useRepositories } from "./useRepositories";
interface PublicationState {
  busy: boolean;
  error?: ApiError;
  result?: RepositorySync;
}
interface PublicationContext {
  token: string;
  selected?: GitHubRepository;
  signal: AbortSignal;
  update: (item: GitHubRepository) => void;
}
async function syncPublication(
  context: PublicationContext,
  tag: string,
  registration?: RepositoryRegistration,
) {
  const { token, signal, update } = context;
  const repository = registration
    ? await api.registerRepository(registration, token, signal)
    : context.selected;
  if (!repository || signal.aborted)
    throw new DOMException("Cancelled", "AbortError");
  if (registration) update(repository);
  const result = await api.syncRepository(repository.id, tag, token, signal);
  if (!signal.aborted) update({ ...repository, last_sync: { ...result, tag } });
  return result;
}
function publicationFailure(
  failure: unknown,
  signal: AbortSignal,
  expire: () => void,
  setState: Dispatch<SetStateAction<PublicationState>>,
) {
  if (signal.aborted) return;
  const error =
    failure instanceof ApiError ? failure : new ApiError(0, "network_error");
  if (error.status === 401) expire();
  else setState({ busy: false, error });
}
export function useRepositoryPublication(
  token: string,
  expire: () => void,
  published: () => void,
) {
  const repositories = useRepositories(token, expire);
  const [selected, setSelected] = useState("");
  const [state, setState] = useState<PublicationState>({ busy: false });
  const mutation = useRef<AbortController | null>(null);
  useEffect(() => () => mutation.current?.abort(), [token]);
  function publish(tag: string, registration?: RepositoryRegistration) {
    if (mutation.current) return;
    const controller = new AbortController();
    mutation.current = controller;
    setState({ busy: true });
    const context: PublicationContext = {
      token,
      signal: controller.signal,
      selected: repositories.state.items.find((item) => item.id === selected),
      update: (item) => {
        setSelected(item.id);
        repositories.update(item);
      },
    };
    void syncPublication(context, tag, registration)
      .then((result) => {
        if (controller.signal.aborted) return;
        setState({ busy: false, result });
        published();
      })
      .catch((failure: unknown) =>
        publicationFailure(failure, controller.signal, expire, setState),
      )
      .finally(() => {
        if (mutation.current === controller) mutation.current = null;
      });
  }
  return {
    ...state,
    repositories: repositories.state,
    selected,
    publish,
    more: repositories.more,
    select: (id: string) => {
      setSelected(id);
      setState({ busy: false });
    },
  };
}
