import {
  BookOpen,
  LayoutDashboard,
  LogOut,
  Menu,
  X,
  PackageSearch,
  Terminal,
  ChevronRight,
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
  navigate(
    event.currentTarget.pathname +
      event.currentTarget.search +
      event.currentTarget.hash,
  );
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
    route.kind === "baseline-package"
      ? `baseline:${route.slug}:${route.name}:${route.version}`
      : route.kind === "project"
        ? `project:${route.slug}`
        : route.kind === "package"
          ? `package:${route.name}`
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
          </span>
          <button
            className="mobile-close icon-button"
            aria-label="Fechar navegação"
            onClick={() => setMobileOpen(false)}
          >
            <X />
          </button>
        </div>
        <PersonalNavigation
          me={me}
          kind={route.kind}
          isMarketplace={isMarketplace}
          close={() => setMobileOpen(false)}
        />
        <div className="sidebar-note">
          <span>DO CONTEXTO AO CÓDIGO</span>
          <p>
            Escolha seus recursos.
            <br />
            Construa no seu terminal.
          </p>
        </div>
      </aside>
      <div className="main-shell" inert={mobileOpen}>
        <header
          className={`topbar ${route.kind === "marketplace" ? "catalog-topbar" : ""}`}
        >
          <div className="breadcrumb">
            <BookOpen size={16} />
            <strong>{surfaceTitle(route.kind, isMarketplace)}</strong>
          </div>
          {route.kind !== "marketplace" && (
            <MarketplaceSearch filters={filters} />
          )}
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

function PersonalNavigation({
  me,
  kind,
  isMarketplace,
  close,
}: {
  me: Me;
  kind: string;
  isMarketplace: boolean;
  close: () => void;
}) {
  const profile = kind === "profile" || kind === "tokens";
  const links = [
    {
      href: "/marketplace",
      label: "Marketplace",
      icon: PackageSearch,
      active: isMarketplace,
    },
    {
      href: "/workspace",
      label: "Workspace",
      icon: LayoutDashboard,
      active:
        kind === "workspace" ||
        kind === "project" ||
        kind === "baseline-package",
    },
    { href: "/cli", label: "CLI", icon: Terminal, active: kind === "cli" },
  ];
  return (
    <nav aria-label="Navegação principal">
      <a
        className={`personal-profile-link ${profile ? "active" : ""}`}
        aria-label="Meu perfil"
        aria-current={profile ? "page" : undefined}
        href="/profile"
        onClick={(event) => {
          followLink(event);
          close();
        }}
      >
        <span className="avatar" aria-hidden="true">
          {me.user.name.slice(0, 2).toUpperCase()}
        </span>
        <span className="profile-link-copy">
          <strong>{me.user.name}</strong>
          <small>{me.user.email}</small>
          <span>Meu perfil</span>
        </span>
        <ChevronRight size={15} aria-hidden="true" />
      </a>
      <div className="nav-label">SEU AMBIENTE</div>
      {links.map(({ href, label, icon: Icon, active }) => (
        <a
          key={href}
          className={`nav-item ${active ? "active" : ""}`}
          aria-current={active ? "page" : undefined}
          href={href}
          onClick={(event) => {
            followLink(event);
            close();
          }}
        >
          <Icon size={19} aria-hidden="true" />
          {label}
        </a>
      ))}
    </nav>
  );
}
function surfaceTitle(kind: string, marketplace: boolean) {
  if (marketplace) return "Marketplace";
  if (kind === "profile" || kind === "tokens") return "Meu perfil";
  return kind === "cli" ? "CLI · Começar" : "Workspace";
}
