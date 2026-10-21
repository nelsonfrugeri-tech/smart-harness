import { Bot, Braces, Layers3, Plug } from "lucide-react";
import type { WorkspaceData } from "../api/client";
import {
  marketplacePath,
  type MarketplaceFilters as Filters,
} from "../app/marketplaceQuery";
import { navigate } from "../app/navigation";
import { followLink } from "./Shell";
const options = [
  { value: undefined, label: "Todos", icon: Layers3 },
  { value: "agent", label: "Com agentes", icon: Bot },
  { value: "skill", label: "Com skills", icon: Braces },
  { value: "mcp", label: "Com MCPs", icon: Plug },
] as const;
export function MarketplaceFilters({
  filters,
  projects,
}: {
  filters: Filters;
  projects: WorkspaceData["projects"];
}) {
  const knownProject = projects.some(
    (project) => project.slug === filters.project,
  );
  return (
    <div className="marketplace-controls">
      <div
        className="component-filters"
        role="group"
        aria-label="Pacotes contendo"
      >
        {options.map(({ value, label, icon: Icon }) => (
          <button
            key={value ?? "all"}
            type="button"
            className="component-filter"
            aria-pressed={filters.kind === value}
            onClick={() =>
              navigate(marketplacePath({ ...filters, kind: value }))
            }
          >
            <Icon size={16} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <div className="marketplace-availability">
        <label className="availability-select">
          <span>Pacotes disponíveis</span>
          <select
            value={filters.project ?? ""}
            onChange={(event) =>
              navigate(
                marketplacePath({
                  ...filters,
                  project: event.target.value || undefined,
                }),
              )
            }
          >
            <option value="">Todos os pacotes disponíveis</option>
            {filters.project && !knownProject && (
              <option value={filters.project}>Projeto indisponível</option>
            )}
            {projects.map((project) => (
              <option key={project.slug} value={project.slug}>
                Complementos de {project.name}
              </option>
            ))}
          </select>
        </label>
        {(filters.kind || filters.q || filters.project) && (
          <a
            className="text-link"
            href={marketplacePath({ limit: filters.limit })}
            onClick={followLink}
          >
            Limpar filtros
          </a>
        )}
      </div>
    </div>
  );
}
