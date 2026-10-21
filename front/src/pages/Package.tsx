import { useCallback } from "react";
import { ArrowLeft } from "lucide-react";
import { api } from "../api/client";
import {
  marketplacePath,
  type MarketplaceFilters,
} from "../app/marketplaceQuery";
import { useResource } from "../app/useResource";
import { PackageSummary } from "../components/PackageSummary";
import { PackageContents } from "../components/PackageContents";
import { PageHeading } from "../components/Primitives";
import { Loading, RequestError } from "../components/RequestState";
import { followLink } from "../components/Shell";
export function Package({
  name,
  filters,
  token,
  expire,
}: {
  name: string;
  filters: MarketplaceFilters;
  token: string;
  expire: () => void;
}) {
  const load = useCallback(
    (signal: AbortSignal) => api.plugin(name, token, signal),
    [name, token],
  );
  const { state, retry } = useResource(name, load, expire);
  return (
    <div className="page package-page">
      <a
        className="text-link package-back"
        href={marketplacePath(filters)}
        onClick={followLink}
      >
        <ArrowLeft size={16} />
        Voltar aos resultados
      </a>
      {state.status === "loading" ? (
        <Loading label="Carregando pacote…" />
      ) : state.status === "error" ? (
        <RequestError error={state.error} retry={retry} />
      ) : (
        <>
          <PageHeading
            title={state.data.plugin.name}
            description={
              state.data.version.description ||
              state.data.plugin.description ||
              "Sem descrição cadastrada."
            }
          />
          <div className="package-detail-meta">
            <span>{state.data.plugin.tenant.name}</span>
            <span className="package-version">
              v{state.data.version.version}
            </span>
            <PackageSummary item={state.data} />
          </div>
          <section className="panel package-panel package-detail-content">
            <h2>Componentes do pacote</h2>
            <p className="package-summary">
              Composição da última versão disponível para sua conta.
            </p>
            <PackageContents item={state.data} grouped />
          </section>
        </>
      )}
    </div>
  );
}
