import { Bot, Braces, Plug } from "lucide-react";
import type { PluginItem } from "../api/client";
const labels = { agent: "Agente", skill: "Skill", mcp: "MCP" } as const;
const icons = { agent: Bot, skill: Braces, mcp: Plug } as const;
export function PackageContents({
  item,
  compact = false,
}: {
  item: PluginItem;
  compact?: boolean;
}) {
  if (item.components.length === 0)
    return <p>Este pacote não possui componentes cadastrados.</p>;
  return (
    <ul
      className={`component-list ${compact ? "component-list-compact" : ""}`}
      aria-label={`Componentes de ${item.plugin.name} v${item.version.version}`}
    >
      {item.components.map((component) => {
        const Icon = icons[component.kind];
        return (
          <li
            key={`${item.plugin.name}@${item.version.version}:${component.kind}:${component.name}`}
          >
            <span className="capability-icon">
              <Icon size={20} />
            </span>
            <div>
              <span className="component-kind">{labels[component.kind]}</span>
              <h4>{component.name}</h4>
              {!compact && (
                <p>{component.description || "Sem descrição cadastrada."}</p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
