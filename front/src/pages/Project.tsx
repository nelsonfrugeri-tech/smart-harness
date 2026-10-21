import { useCallback } from "react";
import { ArrowLeft } from "lucide-react";
import { api, type SetupPlan, type WorkspaceData } from "../api/client";
import { useResource } from "../app/useResource";
import { marketplacePath } from "../app/marketplaceQuery";
import { baselinePackagePath, navigate, projectPath } from "../app/navigation";
import { SetupInstructions } from "../components/SetupInstructions";
import { SetupOptionals } from "../components/SetupOptionals";
import { PackageSummary } from "../components/PackageSummary";
import { PackageContents } from "../components/PackageContents";
import { followLink } from "../components/Shell";
import {
  Badge,
  EmptyState,
  PageHeading,
  SectionTitle,
} from "../components/Primitives";
import { Loading, RequestError } from "../components/RequestState";
interface Props {
  slug: string;
  token: string;
  expire: () => void;
  projects: WorkspaceData["projects"];
}
export function Project({ slug, token, expire, projects }: Props) {
  const load = useCallback(
    (signal: AbortSignal) => api.plan(slug, token, signal),
    [slug, token],
  );
  const { state, retry } = useResource(slug, load, expire);
  return (
    <div className="page project-page">
      <div className="project-toolbar">
        <a className="text-link" href="/workspace" onClick={followLink}>
          <ArrowLeft size={16} />
          Todos os projetos
        </a>
        <label className="project-select">
          <span>PROJETO</span>
          <select
            aria-label="Projeto"
            value={
              projects.some((project) => project.slug === slug) ? slug : ""
            }
            onChange={(event) => navigate(projectPath(event.target.value))}
          >
            <option value="" disabled>
              Selecionar projeto
            </option>
            {projects.map((project) => (
              <option key={project.slug} value={project.slug}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {state.status === "loading" ? (
        <Loading label="Carregando composição do projeto…" />
      ) : state.status === "error" ? (
        <RequestError error={state.error} retry={retry} />
      ) : (
        <ProjectContent
          key={slug}
          plan={state.data}
          token={token}
          expire={expire}
        />
      )}
    </div>
  );
}
function ProjectContent({
  plan,
  token,
  expire,
}: {
  plan: SetupPlan;
  token: string;
  expire: () => void;
}) {
  return (
    <>
      <PageHeading
        eyebrow={plan.project.tenant.name}
        title={plan.project.name}
        description={plan.project.description || "Sem descrição cadastrada."}
      />
      <section className="baseline-intro focus-project">
        <div>
          <Badge tone="white">Pacote base do projeto</Badge>
          <h2>Prepare seu ambiente de desenvolvimento.</h2>
          <p>
            Instale o contexto definido pela squad com as versões fixadas
            abaixo. Siga os passos para configurar o Claude Code com seu token
            pessoal.
          </p>
        </div>
        <a className="button button-primary" href="#setup">
          Preparar ambiente
        </a>
      </section>
      <SectionTitle
        title="Composição do pacote base"
        action={
          <a
            className="text-link"
            href={marketplacePath({ project: plan.project.slug })}
            onClick={followLink}
          >
            Explorar complementos
          </a>
        }
      />
      {plan.baseline.length === 0 ? (
        <EmptyState
          title="Pacote base ainda não definido"
          description="A squad ainda não vinculou pacotes a este projeto."
        />
      ) : (
        <div className="baseline-list">
          {plan.baseline.map((item) => (
            <Package
              key={`${item.plugin.name}@${item.version.version}`}
              item={item}
              project={plan.project.slug}
            />
          ))}
        </div>
      )}
      <SetupInstructions plan={plan} />
      <SetupOptionals plan={plan} token={token} expire={expire} />
    </>
  );
}
function Package({
  item,
  project,
}: {
  item: SetupPlan["baseline"][number];
  project: string;
}) {
  return (
    <section className="panel package-panel">
      <div className="section-heading">
        <div>
          <h3>
            <a
              href={baselinePackagePath(
                project,
                item.plugin.name,
                item.version.version,
              )}
              onClick={followLink}
            >
              {item.plugin.name}
            </a>
          </h3>
          <p>
            {item.version.description ||
              item.plugin.description ||
              "Sem descrição cadastrada."}
          </p>
        </div>
        <Badge tone="blue">v{item.version.version} · fixada</Badge>
      </div>
      <PackageSummary item={item} />
      <details className="baseline-components">
        <summary>Ver componentes do pacote</summary>
        <PackageContents item={item} />
      </details>
    </section>
  );
}
