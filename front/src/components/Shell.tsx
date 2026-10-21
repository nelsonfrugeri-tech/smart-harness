import {
  BookOpen,
  LayoutDashboard,
  LogOut,
  Menu,
  X,
  PackageSearch,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent,
} from "react";
import type { Me } from "../api/client";
import { navigate, useRoute } from "../app/navigation";
import { MarketplaceSearch } from "./MarketplaceSearch";
import { Button } from "./Primitives";
export function followLink(event: MouseEvent<HTMLAnchorElement>) {
  if (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  event.preventDefault();
  navigate(event.currentTarget.pathname + event.currentTarget.search);
}
export function Shell({
  children,
  me,
  logout,
}: {
  children: ReactNode;
  me: Me;
  logout: () => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const route = useRoute();
  const isMarketplace =
    route.kind === "marketplace" || route.kind === "package";
  const filters = isMarketplace ? route.filters : {};
  const routeKey =
    route.kind === "project"
      ? route.slug
      : route.kind === "package"
        ? route.name
        : route.kind;
  useEffect(() => {
    if (
      document.activeElement instanceof HTMLSelectElement &&
      document.activeElement.getAttribute("aria-label") === "Projeto"
    )
      return;
    document.getElementById("main")?.focus();
  }, [routeKey]);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 721px)");
    const closeOnWide = () => {
      if (query.matches) setMobileOpen(false);
    };
    query.addEventListener("change", closeOnWide);
    return () => query.removeEventListener("change", closeOnWide);
  }, []);
  const opener = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!mobileOpen) return;
    const element = sidebar.current;
    const trigger = opener.current;
    element?.querySelector<HTMLButtonElement>(".mobile-close")?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileOpen(false);
        return;
      }
      if (event.key !== "Tab" || !element) return;
      const items = Array.from(
        element.querySelectorAll<HTMLElement>("button, a[href]"),
      ).filter((item) => item.getClientRects().length > 0);
      const first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      trigger?.focus();
    };
  }, [mobileOpen]);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Pular para o conteúdo
      </a>
      <button
        ref={opener}
        className="mobile-toggle icon-button"
        aria-expanded={mobileOpen}
        aria-controls="workspace-sidebar"
        aria-label="Abrir navegação"
        onClick={() => setMobileOpen(true)}
      >
        <Menu />
      </button>
      {mobileOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Fechar navegação"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        ref={sidebar}
        id="workspace-sidebar"
        className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}
      >
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            smart<span className="brand-light">harness</span>
            <small>DEVELOPER WORKSPACE</small>
          </span>
          <button
            className="mobile-close icon-button"
            aria-label="Fechar navegação"
            onClick={() => setMobileOpen(false)}
          >
            <X />
          </button>
        </div>
        <div className="nav-label">DESENVOLVER</div>
        <nav aria-label="Navegação principal">
          <a
            className={`nav-item ${!isMarketplace ? "active" : ""}`}
            aria-current={!isMarketplace ? "page" : undefined}
            href="/workspace"
            onClick={(event) => {
              followLink(event);
              setMobileOpen(false);
            }}
          >
            <LayoutDashboard size={19} />
            Meu workspace
          </a>
          <a
            className={`nav-item ${isMarketplace ? "active" : ""}`}
            aria-current={isMarketplace ? "page" : undefined}
            href="/marketplace"
            onClick={(event) => {
              followLink(event);
              setMobileOpen(false);
            }}
          >
            <PackageSearch size={19} />
            Marketplace
          </a>
        </nav>
        <SidebarIdentity me={me} />
      </aside>
      <div className="main-shell" inert={mobileOpen}>
        <header className="topbar">
          <div className="breadcrumb">
            <BookOpen size={16} />
            <strong>{isMarketplace ? "Marketplace" : "Workspace"}</strong>
          </div>
          <MarketplaceSearch filters={filters} />
          <Button variant="ghost" onClick={logout}>
            <LogOut size={16} />
            Sair
          </Button>
        </header>
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <footer className="app-footer">
          <span>Smart Harness · Contexto para desenvolver.</span>
          <span>Ambiente local</span>
        </footer>
      </div>
    </div>
  );
}

function SidebarIdentity({ me }: { me: Me }) {
  return (
    <>
      <div className="membership-list">
        <h2>Seus acessos</h2>
        {me.memberships.length === 0 ? (
          <p>Sem vínculo com uma squad.</p>
        ) : (
          me.memberships.map((membership) => (
            <div key={membership.tenant.id}>
              <strong>{membership.tenant.name}</strong>
              <small>
                {membership.role === "ADMIN"
                  ? "Administrador"
                  : "Desenvolvedor"}
              </small>
            </div>
          ))
        )}
      </div>
      <div className="sidebar-bottom">
        <div className="sidebar-profile">
          <span className="avatar" aria-hidden="true">
            {me.user.name.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <strong>{me.user.name}</strong>
            <small>{me.user.email}</small>
          </div>
        </div>
      </div>
    </>
  );
}
