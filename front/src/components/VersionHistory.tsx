import { Download } from "lucide-react";
import type { PluginVersion } from "../api/client";
import { useVersionHistory } from "../app/useVersionHistory";
import { usePaginationFocus } from "../app/usePaginationFocus";
import { Button, EmptyState } from "./Primitives";
import { Loading, RequestError } from "./RequestState";
import { VersionMetadata } from "./VersionMetadata";
export function VersionHistory({
  name,
  current,
  limit,
  token,
  expire,
  download,
  busy,
}: {
  name: string;
  current: string;
  limit: number;
  token: string;
  expire: () => void;
  download: (version: PluginVersion) => void;
  busy: boolean;
}) {
  const { state, more, restart } = useVersionHistory(
    name,
    limit,
    token,
    expire,
  );
  const pagination = usePaginationFocus(
    state.items.map((item) => item.version),
    state.loading,
    `${name}:${limit}`,
    more,
  );
  return (
    <section
      className="panel version-history"
      aria-label="Versões publicadas"
      ref={pagination.results}
    >
      <h2>Versões publicadas</h2>
      <p className="history-intro">
        Em ordem de publicação. O histórico informa os arquivos disponíveis; os
        componentes acima pertencem à versão em exibição.
      </p>
      {state.items.length === 0 && state.loading ? (
        <Loading label="Carregando versões…" />
      ) : (
        <>
          <ol className="version-list">
            {state.items.map((version) => (
              <li key={version.version}>
                <div className="version-heading">
                  <h3>v{version.version}</h3>
                  {version.version === current && (
                    <span className="version-current">Em exibição</span>
                  )}
                  <Button
                    variant="secondary"
                    aria-label={`Baixar versão ${version.version} do histórico`}
                    aria-disabled={busy}
                    onClick={() => {
                      if (!busy) download(version);
                    }}
                    data-page-item={version.version}
                  >
                    <Download size={15} />
                    Baixar
                  </Button>
                </div>
                <p>{version.description || "Sem descrição cadastrada."}</p>
                <VersionMetadata version={version} />
              </li>
            ))}
          </ol>
          {!state.error && state.items.length === 0 && (
            <EmptyState
              title="Nenhuma versão disponível"
              description="Não há versões publicadas disponíveis para sua conta."
            />
          )}
          {state.error && (
            <div className="pagination-error">
              {state.error.code === "invalid_cursor" ? (
                <div role="alert">
                  <p>A consulta de versões precisa ser reiniciada.</p>
                  <Button onClick={restart}>Reiniciar histórico</Button>
                </div>
              ) : (
                <RequestError
                  error={state.error}
                  retry={state.items.length ? pagination.loadMore : restart}
                />
              )}
            </div>
          )}
          {state.cursor && !state.error && (
            <div className="load-more">
              <Button
                variant="secondary"
                onClick={pagination.loadMore}
                onBlur={pagination.cancelFocus}
                aria-disabled={state.loading}
              >
                {state.loading
                  ? "Carregando mais versões…"
                  : "Carregar mais versões"}
              </Button>
            </div>
          )}
          {!state.cursor && !state.error && state.items.length > 0 && (
            <p className="result-end" tabIndex={-1}>
              Todas as versões disponíveis foram carregadas.
            </p>
          )}
        </>
      )}
    </section>
  );
}
