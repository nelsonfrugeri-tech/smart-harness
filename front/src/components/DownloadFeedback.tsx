import type { PluginVersion } from "../api/client";
import type { DownloadState } from "../app/useArchiveDownload";
import { Button } from "./Primitives";
export function DownloadFeedback({
  state,
  retry,
}: {
  state: DownloadState;
  retry: (version: PluginVersion) => void;
}) {
  if (state.status === "idle") return null;
  if (state.status === "loading")
    return (
      <p className="download-status" role="status">
        Baixando e conferindo v{state.version.version}…
      </p>
    );
  if (state.status === "success")
    return (
      <p className="download-status download-success" role="status">
        v{state.version.version}: SHA-256 conferido. Download enviado ao
        navegador.
      </p>
    );
  const unavailable = state.error.status === 403 || state.error.status === 404;
  const invalid =
    state.error.code === "invalid_archive" ||
    state.error.code === "digest_mismatch";
  return (
    <div className="panel request-error download-error" role="alert">
      <h2>
        {unavailable ? "Arquivo indisponível" : "Não foi possível baixar"}
      </h2>
      <p>
        {unavailable
          ? "Este arquivo não está disponível para sua conta."
          : invalid
            ? "O arquivo recebido não corresponde ao pacote publicado. Nenhum arquivo foi salvo."
            : "O arquivo não pôde ser obtido. Tente novamente."}
      </p>
      {state.error.correlationId && (
        <details>
          <summary>Informações para suporte</summary>
          <code>{state.error.correlationId}</code>
        </details>
      )}
      <Button variant="secondary" onClick={() => retry(state.version)}>
        Tentar download novamente
      </Button>
    </div>
  );
}
