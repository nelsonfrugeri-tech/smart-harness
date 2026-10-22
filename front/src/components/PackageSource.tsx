import { ExternalLink, Github } from "lucide-react";
import type { PluginItem } from "../api/client";
import { Badge } from "./Primitives";
type SourceKind = NonNullable<PluginItem["source"]>["kind"];
export function PackageOrigin({ kind }: { kind?: SourceKind }) {
  if (kind !== "internal" && kind !== "open-source") return null;
  return (
    <Badge tone={kind === "open-source" ? "green" : "neutral"}>
      {kind === "open-source" ? "Open source" : "Interno"}
    </Badge>
  );
}
function repositoryURL(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname)
    )
      return null;
    return url.toString();
  } catch {
    return null;
  }
}
function RepositoryLink({ url, name }: { url?: string; name: string }) {
  const target = repositoryURL(url);
  if (!target) return null;
  return (
    <a
      className="text-link package-source-link"
      href={target}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Ver ${name} no GitHub (abre nova aba)`}
    >
      <Github size={16} aria-hidden="true" />
      Ver no GitHub
      <ExternalLink size={13} aria-hidden="true" />
    </a>
  );
}
export function PackageSource({ item }: { item: PluginItem }) {
  if (!item.source && !item.related_project) return null;
  return (
    <div className="package-source-grid">
      {item.source && (
        <section
          className="panel package-source"
          aria-labelledby="package-source-title"
        >
          <div className="package-source-heading">
            <h2 id="package-source-title">Origem do pacote</h2>
            <PackageOrigin kind={item.source.kind} />
          </div>
          <p>{item.plugin.name}</p>
          {item.source.license && (
            <p className="package-source-license">
              Licença <strong>{item.source.license}</strong>
            </p>
          )}
          <RepositoryLink
            url={item.source.repository_url}
            name={item.plugin.name}
          />
        </section>
      )}
      {item.related_project && (
        <section
          className="panel package-source"
          aria-labelledby="related-project-title"
        >
          <div className="package-source-heading">
            <h2 id="related-project-title">Projeto relacionado</h2>
            <PackageOrigin kind={item.related_project.kind} />
          </div>
          <p>{item.related_project.name}</p>
          {item.related_project.license && (
            <p className="package-source-license">
              Licença <strong>{item.related_project.license}</strong>
            </p>
          )}
          <RepositoryLink
            url={item.related_project.repository_url}
            name={item.related_project.name}
          />
        </section>
      )}
    </div>
  );
}
