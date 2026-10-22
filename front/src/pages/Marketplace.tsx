import { useRef, useState } from "react";
import { Github, ArrowRight, Package } from "lucide-react";
import type { Me, PluginItem, WorkspaceData } from "../api/client";
import {
  marketplaceSearch,
  packagePath,
  type MarketplaceFilters,
} from "../app/marketplaceQuery";
import { usePaginationFocus } from "../app/usePaginationFocus";
import { useMarketplace } from "../app/useMarketplace";
import { Button, EmptyState, PageHeading } from "../components/Primitives";
import { Loading, RequestError } from "../components/RequestState";
import { PackageDiscovery } from "../components/PackageDiscovery";
import { PackageSummary } from "../components/PackageSummary";
import { MarketplaceSearch } from "../components/MarketplaceSearch";
import { MarketplaceFilters as CatalogFilters } from "../components/MarketplaceFilters";
import { GitHubPublication } from "../components/GitHubPublication";
import { followLink } from "../components/Shell";
interface Props {
  filters: MarketplaceFilters;
  token: string;
  expire: () => void;
  me: Me;
  projects: WorkspaceData["projects"];
}
export function Marketplace({ filters, token, expire, me, projects }: Props) {
  const [publishing, setPublishing] = useState(false);
  const publishTrigger = useRef<HTMLButtonElement>(null);
  const canPublish = me.memberships.some(
    (membership) => membership.role === "ADMIN",
  );
  const { state, more, restart } = useMarketplace(filters, token, expire);
  const pagination = usePaginationFocus(
    state.items.map((item) => item.plugin.name),
    state.loading,
    marketplaceSearch(filters),
    more,
  );
  const project = projects.find((item) => item.slug === filters.project);
  const filtered = Boolean(filters.type || filters.kind || filters.q);
  return (
    <div className="page marketplace-page" ref={pagination.results}>
      <PageHeading
        title="Marketplace"
        action={
          canPublish && (
            <button
              ref={publishTrigger}
              className="button button-secondary"
              onClick={() => setPublishing(true)}
              aria-expanded={publishing}
              aria-controls="github-publication"
            >
              <Github size={17} aria-hidden="true" />
              Publicar do GitHub
            </button>
          )
        }
        description={
          filters.project
            ? `Pacotes adicionais para ${project?.name ?? filters.project}, além do pacote base.`
            : "Tools, Skills e Agents para o seu jeito de desenvolver."
        }
      />
      {publishing && canPublish && (
        <GitHubPublication
          token={token}
          expire={expire}
          memberships={me.memberships}
          published={restart}
          close={() => {
            setPublishing(false);
            publishTrigger.current?.focus();
          }}
        />
      )}
      <section
        className="catalog-discovery"
        aria-label="Buscar e filtrar pacotes"
      >
        <MarketplaceSearch filters={filters} prominent />
        <CatalogFilters filters={filters} projects={projects} />
      </section>
      {filters.q && (
        <p className="search-context">
          Busca por <strong>“{filters.q}”</strong>
        </p>
      )}
      {state.loading && state.items.length === 0 ? (
        <Loading label="Carregando pacotes…" />
      ) : (
        <>
          {state.items.length > 0 && (
            <>
              <p className="result-count" role="status">
                {state.items.length}{" "}
                {state.items.length === 1
                  ? "pacote carregado"
                  : "pacotes carregados"}
              </p>
              <div className="marketplace-grid">
                {state.items.map((item) => (
                  <PackageCard
                    key={item.plugin.name}
                    item={item}
                    filters={filters}
                  />
                ))}
              </div>
            </>
          )}
          {!state.error && state.items.length === 0 && (
            <EmptyState
              title={
                me.memberships.length === 0
                  ? "Nenhum acesso ao Marketplace"
                  : filtered
                    ? "Nenhum pacote encontrado"
                    : filters.project
                      ? "Nenhum complemento disponível"
                      : "Nenhum pacote disponível"
              }
              description={
                me.memberships.length === 0
                  ? "Sua conta ainda não está vinculada a uma squad."
                  : filtered
                    ? "Experimente outra busca ou ajuste os filtros."
                    : filters.project
                      ? "Não há pacotes adicionais disponíveis para este projeto."
                      : "Os pacotes publicados para suas squads aparecerão aqui."
              }
            />
          )}
          {state.error && (
            <div className="pagination-error">
              {state.error.code === "invalid_cursor" ? (
                <div className="panel request-error" role="alert">
                  <h2>Atualize os resultados</h2>
                  <p>
                    A consulta não pode continuar desta página. Reinicie para
                    buscar os pacotes novamente.
                  </p>
                  {state.error.correlationId && (
                    <details>
                      <summary>Informações para suporte</summary>
                      <code>{state.error.correlationId}</code>
                    </details>
                  )}
                  <Button onClick={restart}>Reiniciar consulta</Button>
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
                {state.loading ? "Carregando mais…" : "Carregar mais"}
              </Button>
            </div>
          )}
          {!state.cursor && !state.error && state.items.length > 0 && (
            <p className="result-end" tabIndex={-1}>
              Todos os resultados desta consulta foram carregados.
            </p>
          )}
        </>
      )}
    </div>
  );
}
function PackageCard({
  item,
  filters,
}: {
  item: PluginItem;
  filters: MarketplaceFilters;
}) {
  return (
    <article className="panel marketplace-card">
      <div className="package-card-heading">
        <span className="package-symbol">
          <Package size={22} aria-hidden="true" />
        </span>
        <h2>
          <a
            href={packagePath(item.plugin.name, filters)}
            onClick={followLink}
            data-page-item={item.plugin.name}
          >
            {item.plugin.name}
            <ArrowRight size={17} aria-hidden="true" />
          </a>
        </h2>
      </div>
      <p className="package-description">
        {item.version.description ||
          item.plugin.description ||
          "Sem descrição cadastrada."}
      </p>
      <PackageDiscovery item={item} filters={filters} />
      <PackageSummary item={item} />
      <footer className="package-card-footer">
        <span className="package-owner">{item.plugin.tenant.name}</span>
        <span className="package-version">v{item.version.version}</span>
      </footer>
    </article>
  );
}
