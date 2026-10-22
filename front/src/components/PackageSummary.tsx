import { Bot, Braces, Plug } from "lucide-react";
import type { PluginItem } from "../api/client";
const kinds = [
  { kind: "agent", singular: "Agent", plural: "Agents", icon: Bot },
  { kind: "skill", singular: "Skill", plural: "Skills", icon: Braces },
  { kind: "mcp", singular: "Tool", plural: "Tools", icon: Plug },
] as const;
export function PackageSummary({ item }: { item: PluginItem }) {
  if (item.components.length === 0)
    return <p className="package-empty">Sem componentes cadastrados.</p>;
  return (
    <ul
      className="package-composition"
      aria-label={`Composição de ${item.plugin.name}`}
    >
      {kinds.map(({ kind, singular, plural, icon: Icon }) => {
        const count = item.components.filter(
          (component) => component.kind === kind,
        ).length;
        return count > 0 ? (
          <li key={kind}>
            <Icon size={15} aria-hidden="true" />
            <span>
              {count} {count === 1 ? singular : plural}
            </span>
          </li>
        ) : null;
      })}
    </ul>
  );
}
