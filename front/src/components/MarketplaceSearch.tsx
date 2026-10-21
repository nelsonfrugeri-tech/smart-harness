import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import {
  marketplacePath,
  type MarketplaceFilters,
} from "../app/marketplaceQuery";
import { navigate } from "../app/navigation";
export function MarketplaceSearch({
  filters,
  prominent = false,
}: {
  filters: MarketplaceFilters;
  prominent?: boolean;
}) {
  const [query, setQuery] = useState(filters.q ?? "");
  // Keep the input mounted: changing its key would discard keyboard focus on submit.
  useEffect(() => {
    setQuery(filters.q ?? "");
  }, [filters.q, filters.kind, filters.project, filters.limit]);
  return (
    <form
      className={`marketplace-search ${prominent ? "catalog-search" : ""}`}
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        navigate(marketplacePath({ ...filters, q: query.trim() || undefined }));
      }}
    >
      <label className="sr-only" htmlFor="marketplace-search">
        Buscar pacotes e componentes
      </label>
      {prominent && <Search size={21} aria-hidden="true" />}
      <input
        id="marketplace-search"
        type="search"
        placeholder="Buscar pacotes e componentes"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        maxLength={100}
      />
      <button
        type="submit"
        className={prominent ? "button button-primary" : "icon-button"}
        aria-label="Buscar"
      >
        {prominent ? "Buscar" : <Search size={19} />}
      </button>
    </form>
  );
}
