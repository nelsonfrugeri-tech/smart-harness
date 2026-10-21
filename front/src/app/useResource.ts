import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
export type Resource<T> =
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: ApiError };
export function useResource<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  onUnauthorized: () => void,
) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    attempt: number;
    value: Resource<T>;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted)
          setResult({ key, attempt, value: { status: "success", data } });
      },
      (error) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) {
          onUnauthorized();
          return;
        }
        setResult({
          key,
          attempt,
          value: {
            status: "error",
            error:
              error instanceof ApiError
                ? error
                : new ApiError(0, "network_error"),
          },
        });
      },
    );
    return () => controller.abort();
  }, [key, attempt, load, onUnauthorized]);
  const state: Resource<T> =
    result?.key === key && result.attempt === attempt
      ? result.value
      : { status: "loading" };
  return { state, retry: () => setAttempt((value) => value + 1) };
}
