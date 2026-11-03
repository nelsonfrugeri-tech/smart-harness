import { useCallback, useMemo } from "react";
import { api, ApiError, type Installations } from "../api/client";
import { useResource } from "./useResource";
const nothingReported: Installations = {
  cliVersion: null,
  reportedAt: null,
  plugins: [],
};
const EMPTY: ReadonlySet<string> = new Set();
// Names of the packages the CLI reported as installed on this user's machine.
// A 404 means the route is not deployed yet and reads as "nothing reported".
// Any other failure also yields an empty set: the marker is informational and
// must not block the catalog. A 401 still expires the session.
export function useInstallations(
  token: string,
  expire: () => void,
): ReadonlySet<string> {
  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        return await api.installations(token, signal);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404)
          return nothingReported;
        throw error;
      }
    },
    [token],
  );
  const { state } = useResource("installations", load, expire);
  return useMemo(
    () =>
      state.status === "success"
        ? new Set(state.data.plugins.map((plugin) => plugin.name))
        : EMPTY,
    [state],
  );
}
