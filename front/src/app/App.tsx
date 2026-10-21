import { useCallback } from "react";
import { api, type Me } from "../api/client";
import { Shell } from "../components/Shell";
import { Loading, RequestError, Unavailable } from "../components/RequestState";
import { Login } from "../pages/Login";
import { Marketplace } from "../pages/Marketplace";
import { Package } from "../pages/Package";
import { Button, EmptyState } from "../components/Primitives";
import { Workspace } from "../pages/Workspace";
import { Project } from "../pages/Project";
import { useResource } from "./useResource";
import { useSession } from "./session";
import { navigate, useRoute } from "./navigation";
export function App() {
  const session = useSession();
  const logout = useCallback(() => {
    session.logout();
    navigate("/workspace", true);
  }, [session.logout]);
  const expire = useCallback(() => {
    session.expire();
    navigate("/workspace", true);
  }, [session.expire]);
  if (!session.token)
    return <Login onLogin={session.login} expired={session.expired} />;
  return (
    <Authenticated
      key={session.token}
      token={session.token}
      expire={expire}
      logout={logout}
    />
  );
}
interface AuthProps {
  token: string;
  expire: () => void;
  logout: () => void;
}
function Authenticated({ token, expire, logout }: AuthProps) {
  const load = useCallback(
    (signal: AbortSignal) => api.me(token, signal),
    [token],
  );
  const { state, retry } = useResource("identity", load, expire);
  if (state.status !== "success")
    return (
      <main className="page">
        <button className="text-link" onClick={logout}>
          Voltar ao login
        </button>
        {state.status === "loading" ? (
          <Loading />
        ) : (
          <RequestError error={state.error} retry={retry} />
        )}
      </main>
    );
  return (
    <ConnectedWorkspace
      token={token}
      me={state.data}
      expire={expire}
      logout={logout}
    />
  );
}
function ConnectedWorkspace({
  token,
  me,
  expire,
  logout,
}: AuthProps & { me: Me }) {
  const route = useRoute();
  const load = useCallback(
    (signal: AbortSignal) => api.workspace(token, signal),
    [token],
  );
  const { state, retry } = useResource("workspace", load, expire);
  return (
    <Shell me={me} logout={logout}>
      {route.kind === "invalid-marketplace" ? (
        <div className="page">
          <EmptyState
            title="Filtros inválidos"
            description="Confira a busca e os filtros desta URL."
          />
          <Button onClick={() => navigate("/marketplace", true)}>
            Abrir Marketplace
          </Button>
        </div>
      ) : route.kind === "missing" ? (
        <div className="page">
          <Unavailable />
        </div>
      ) : state.status === "loading" ? (
        <Loading />
      ) : state.status === "error" ? (
        <div className="page">
          <RequestError error={state.error} retry={retry} />
        </div>
      ) : route.kind === "marketplace" ? (
        <Marketplace
          filters={route.filters}
          token={token}
          expire={expire}
          me={me}
          projects={state.data.projects}
        />
      ) : route.kind === "package" ? (
        <Package
          key={route.name}
          name={route.name}
          filters={route.filters}
          token={token}
          expire={expire}
        />
      ) : route.kind === "project" ? (
        <Project
          key={route.slug}
          slug={route.slug}
          token={token}
          expire={expire}
          projects={state.data.projects}
        />
      ) : (
        <Workspace data={state.data} />
      )}
    </Shell>
  );
}
