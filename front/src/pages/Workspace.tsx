import { ArrowUpRight, FolderGit2 } from "lucide-react";
import type { WorkspaceData } from "../api/client";
import {
  Badge,
  EmptyState,
  PageHeading,
  SectionTitle,
} from "../components/Primitives";
import { followLink } from "../components/Shell";
import { projectPath } from "../app/navigation";
export function Workspace({ data }: { data: WorkspaceData }) {
  return (
    <div className="page workspace-page">
      <PageHeading
        eyebrow="SEU WORKSPACE"
        title="Escolha seu projeto"
        description="Abra um projeto para conhecer o pacote base da squad e preparar seu ambiente de desenvolvimento."
      />
      <SectionTitle
        title="Seus projetos"
        description={`${data.projects.length} ${data.projects.length === 1 ? "projeto disponível" : "projetos disponíveis"}`}
      />
      {data.projects.length === 0 ? (
        <EmptyState
          title="Nenhum projeto disponível"
          description="Sua conta ainda não tem projetos. Solicite à sua squad a inclusão nos projetos em que vai trabalhar."
        />
      ) : (
        <div className="project-grid">
          {data.projects.map((project) => (
            <a
              className="project-card panel"
              href={projectPath(project.slug)}
              onClick={followLink}
              key={project.slug}
            >
              <div className="card-top">
                <span className="capability-icon">
                  <FolderGit2 size={23} />
                </span>
                <Badge>{project.tenant.name}</Badge>
              </div>
              <h2>{project.name}</h2>
              <p>{project.description || "Sem descrição cadastrada."}</p>
              <dl className="project-counts">
                <div>
                  <dt>Agentes</dt>
                  <dd>{project.counts.agent}</dd>
                </div>
                <div>
                  <dt>Skills</dt>
                  <dd>{project.counts.skill}</dd>
                </div>
                <div>
                  <dt>MCPs</dt>
                  <dd>{project.counts.mcp}</dd>
                </div>
              </dl>
              <footer>
                <span>Conhecer pacote base</span>
                <ArrowUpRight size={17} />
              </footer>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
