import { useState } from "react";
import { Search } from "lucide-react";
import {
  marketplacePath,
  type MarketplaceFilters,
} from "../app/marketplaceQuery";
import { navigate } from "../app/navigation";
export function MarketplaceSearch({
  filters,
}: {
  filters: MarketplaceFilters;
}) {
  const [query, setQuery] = useState(filters.q ?? "");
  return (
    <form
      className="marketplace-search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        navigate(marketplacePath({ ...filters, q: query.trim() || undefined }));
      }}
    >
      <label className="sr-only" htmlFor="marketplace-search">
        Buscar pacotes e componentes
      </label>
      <input
        id="marketplace-search"
        type="search"
        placeholder="Buscar pacotes e componentes"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        maxLength={100}
      />
      <button type="submit" className="icon-button" aria-label="Buscar">
        <Search size={19} />
      </button>
    </form>
  );
}
