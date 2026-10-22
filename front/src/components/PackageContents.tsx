import { Bot, Braces, Plug } from "lucide-react";
import type { PluginItem } from "../api/client";
const labels = { agent: "Agent", skill: "Skill", mcp: "Tool" } as const;
const groupLabels = { agent: "Agents", skill: "Skills", mcp: "Tools" } as const;
const icons = { agent: Bot, skill: Braces, mcp: Plug } as const;
export function PackageContents({
  item,
  grouped = false,
}: {
  item: PluginItem;
  grouped?: boolean;
}) {
  if (item.components.length === 0)
    return <p>Este pacote não possui componentes cadastrados.</p>;
  if (!grouped)
    return <ComponentList item={item} components={item.components} />;
  return (
    <div className="package-component-groups">
      {(["agent", "skill", "mcp"] as const).map((kind) => {
        const components = item.components.filter(
          (component) => component.kind === kind,
        );
        const Icon = icons[kind];
        return components.length > 0 ? (
          <section
            className="component-group"
            key={kind}
            aria-label={groupLabels[kind]}
          >
            <div className="component-group-heading">
              <Icon size={19} aria-hidden="true" />
              <h3>{groupLabels[kind]}</h3>
              <span>{components.length}</span>
            </div>
            <ComponentList
              item={item}
              components={components}
              groupLabel={groupLabels[kind]}
            />
          </section>
        ) : null;
      })}
    </div>
  );
}
function ComponentList({
  item,
  components,
  groupLabel,
}: {
  item: PluginItem;
  components: PluginItem["components"];
  groupLabel?: string;
}) {
  return (
    <ul
      className="component-list"
      aria-label={`${groupLabel ?? "Componentes"} de ${item.plugin.name} v${item.version.version}`}
    >
      {components.map((component) => {
        const Icon = icons[component.kind];
        return (
          <li
            key={`${item.plugin.name}@${item.version.version}:${component.kind}:${component.name}`}
          >
            {!groupLabel && (
              <span className="capability-icon">
                <Icon size={20} />
              </span>
            )}
            <div>
              {!groupLabel && (
                <span className="component-kind">{labels[component.kind]}</span>
              )}
              <h4>{component.name}</h4>
              <p>{component.description || "Sem descrição cadastrada."}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
