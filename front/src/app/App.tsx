import { useCallback } from "react";
import { api, type Me } from "../api/client";
import { Shell } from "../components/Shell";
import { Loading, RequestError, Unavailable } from "../components/RequestState";
import { Login } from "../pages/Login";
import { Workspace } from "../pages/Workspace";
import { Project } from "../pages/Project";
import { useResource } from "./useResource";
import { useSession } from "./session";
import { navigate, useRoute } from "./navigation";
export function App() {
  const session = useSession();
  const { logout: clearSession, expire: expireSession } = session;
  const logout = useCallback(() => {
    clearSession();
    navigate("/workspace", true);
  }, [clearSession]);
  const expire = useCallback(() => {
    expireSession();
    navigate("/workspace", true);
  }, [expireSession]);
  if (!session.token)
    return <Login onLogin={session.login} expired={session.expired} />;
  return (
    <Authenticated
      key={session.token}
      token={session.token}
      initialMe={session.me}
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
function Authenticated({
  token,
  expire,
  logout,
  initialMe,
}: AuthProps & { initialMe?: Me }) {
  const load = useCallback(
    (signal: AbortSignal) =>
      initialMe ? Promise.resolve(initialMe) : api.me(token, signal),
    [token, initialMe],
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
      {route.kind === "missing" ? (
        <div className="page">
          <Unavailable />
        </div>
      ) : state.status === "loading" ? (
        <Loading />
      ) : state.status === "error" ? (
        <div className="page">
          <RequestError error={state.error} retry={retry} />
        </div>
      ) : route.kind === "project" ? (
        <Project
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
