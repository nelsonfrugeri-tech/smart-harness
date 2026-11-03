// Contract with the harness CLI: `harness vendor=claude` starts the bundled
// claude-tap live viewer at this loopback address (its recording proxy listens
// on 127.0.0.1:8788). Traces never leave the developer's machine, so this URL
// always points at the current user's own data.
export const OBSERVABILITY_VIEWER_URL = "http://127.0.0.1:8787";
const PROBE_TIMEOUT_MS = 5000;
// Resolves when something answers at the viewer address (the opaque response
// is not inspected) and rejects when the connection is refused or times out.
export async function probeViewer(signal: AbortSignal): Promise<void> {
  await fetch(OBSERVABILITY_VIEWER_URL, {
    mode: "no-cors",
    cache: "no-store",
    credentials: "omit",
    signal: AbortSignal.any([signal, AbortSignal.timeout(PROBE_TIMEOUT_MS)]),
  });
}
