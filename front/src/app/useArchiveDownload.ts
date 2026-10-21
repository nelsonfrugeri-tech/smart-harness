import { useEffect, useRef, useState } from "react";
import { ApiError, type PluginVersion } from "../api/client";
import { fetchArchive } from "../api/archive";
export type DownloadState =
  | { status: "idle" }
  | { status: "loading"; version: PluginVersion }
  | { status: "success"; version: PluginVersion }
  | { status: "error"; version: PluginVersion; error: ApiError };
function saveArchive(blob: Blob, name: string, version: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}-${version}.tar.gz`;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Defer release until the browser has handled the download activation.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
export function useArchiveDownload(
  name: string,
  token: string,
  expire: () => void,
) {
  const [state, setState] = useState<DownloadState>({ status: "idle" });
  const request = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      request.current?.abort();
    },
    [name, token],
  );
  const download = async (version: PluginVersion) => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setState({ status: "loading", version });
    try {
      const blob = await fetchArchive(name, version, token, controller.signal);
      if (controller.signal.aborted) return;
      saveArchive(blob, name, version.version);
      setState({ status: "success", version });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) {
        expire();
        return;
      }
      setState({
        status: "error",
        version,
        error:
          error instanceof ApiError
            ? error
            : new ApiError(0, "download_failed"),
      });
    } finally {
      if (request.current === controller) request.current = null;
    }
  };
  return { state, download, busy: state.status === "loading" };
}
