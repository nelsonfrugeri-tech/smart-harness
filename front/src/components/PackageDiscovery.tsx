import type { PluginItem } from "../api/client";
import {
  marketplacePath,
  type MarketplaceFilters,
} from "../app/marketplaceQuery";
import { PackageOrigin } from "./PackageSource";
import { Badge } from "./Primitives";
import { followLink } from "./Shell";
const typeLabels = {
  connector: "Tool",
  skill: "Skill",
  agent: "Agent",
} as const;
export function PackageDiscovery({
  item,
  filters,
}: {
  item: PluginItem;
  filters: MarketplaceFilters;
}) {
  return (
    <div className="package-discovery">
      <Badge tone="blue">{typeLabels[item.type]}</Badge>
      <PackageOrigin kind={item.source?.kind} />
      {item.keywords.length > 0 && (
        <ul className="package-tags" aria-label={`Tags de ${item.plugin.name}`}>
          {item.keywords.map((keyword) => (
            <li key={keyword}>
              <a
                href={marketplacePath({ ...filters, q: keyword })}
                onClick={followLink}
                aria-label={`Buscar por ${keyword}`}
              >
                {keyword}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
