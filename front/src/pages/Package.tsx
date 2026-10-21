import { useCallback } from "react";
import { ArrowLeft, Download } from "lucide-react";
import { api, ApiError, type PluginItem } from "../api/client";
import {
  marketplacePath,
  packagePath,
  type MarketplaceFilters,
} from "../app/marketplaceQuery";
import { projectPath } from "../app/navigation";
import { useResource } from "../app/useResource";
import { useArchiveDownload } from "../app/useArchiveDownload";
import { PackageSummary } from "../components/PackageSummary";
import { PackageContents } from "../components/PackageContents";
import { DownloadFeedback } from "../components/DownloadFeedback";
import { VersionMetadata } from "../components/VersionMetadata";
import { VersionHistory } from "../components/VersionHistory";
import { Badge, Button, PageHeading } from "../components/Primitives";
import { Loading, RequestError } from "../components/RequestState";
import { followLink } from "../components/Shell";
interface Props {
  name: string;
  filters: MarketplaceFilters;
  token: string;
  expire: () => void;
  baseline?: { project: string; version: string };
}
export function Package({ name, filters, token, expire, baseline }: Props) {
  const project = baseline?.project,
    version = baseline?.version;
  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!project) return api.plugin(name, token, signal);
      const plan = await api.plan(project, token, signal);
      const item = plan.baseline.find(
        (entry) =>
          entry.plugin.name === name && entry.version.version === version,
      );
      if (!item) throw new ApiError(404, "not_found");
      return item;
    },
    [name, token, project, version],
  );
  const { state, retry } = useResource(
    `${name}:${project ?? "latest"}:${version ?? ""}`,
    load,
    expire,
  );
  return (
    <div className="page package-page">
      <a
        className="text-link package-back"
        href={project ? projectPath(project) : marketplacePath(filters)}
        onClick={followLink}
      >
        <ArrowLeft size={16} />
        {project ? "Voltar ao projeto" : "Voltar aos resultados"}
      </a>
      {state.status === "loading" ? (
        <Loading label="Carregando pacote…" />
      ) : state.status === "error" ? (
        <RequestError error={state.error} retry={retry} />
      ) : (
        <PackageDetail
          key={`${name}:${project ?? "latest"}:${state.data.version.version}`}
          item={state.data}
          filters={filters}
          token={token}
          expire={expire}
          pinned={Boolean(project)}
        />
      )}
    </div>
  );
}
function PackageDetail({
  item,
  filters,
  token,
  expire,
  pinned,
}: {
  item: PluginItem;
  filters: MarketplaceFilters;
  token: string;
  expire: () => void;
  pinned: boolean;
}) {
  const download = useArchiveDownload(item.plugin.name, token, expire);
  return (
    <>
      <PageHeading
        title={item.plugin.name}
        description={
          item.version.description ||
          item.plugin.description ||
          "Sem descrição cadastrada."
        }
        action={
          <Button
            onClick={() => {
              if (!download.busy) void download.download(item.version);
            }}
            aria-disabled={download.busy}
          >
            <Download size={17} />
            Baixar v{item.version.version}
          </Button>
        }
      />
      <div className="package-detail-meta">
        <span>{item.plugin.tenant.name}</span>
        <span className="package-version">v{item.version.version}</span>
        <Badge tone="blue">
          {pinned ? "Versão fixada no projeto" : "Mais recente disponível"}
        </Badge>
        <PackageSummary item={item} />
      </div>
      {pinned && (
        <a
          className="text-link latest-package-link"
          href={packagePath(item.plugin.name, filters)}
          onClick={followLink}
        >
          Ver versão mais recente disponível
        </a>
      )}
      <DownloadFeedback state={download.state} retry={download.download} />
      <section
        className="panel package-release"
        aria-label="Versão em exibição"
      >
        <VersionMetadata version={item.version} />
      </section>
      <section className="panel package-panel package-detail-content">
        <h2>Componentes do pacote</h2>
        <p className="package-summary">
          {pinned
            ? `Composição da versão ${item.version.version}, fixada para este projeto.`
            : `Composição da versão ${item.version.version}, a mais recente disponível para sua conta.`}
        </p>
        <PackageContents item={item} grouped />
      </section>
      <VersionHistory
        key={`${item.plugin.name}:${filters.limit ?? 20}:${token}`}
        name={item.plugin.name}
        current={item.version.version}
        limit={filters.limit ?? 20}
        token={token}
        expire={expire}
        download={download.download}
        busy={download.busy}
      />
    </>
  );
}
