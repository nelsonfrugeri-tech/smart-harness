import { useCallback, useState } from "react";
import { api, type SetupPlan } from "../api/client";
import { useResource } from "../app/useResource";
import { marketplacePath, packagePath } from "../app/marketplaceQuery";
import { Button } from "./Primitives";
import { Loading, RequestError } from "./RequestState";
import { followLink } from "./Shell";
export function SetupOptionals({
  plan,
  token,
  expire,
}: {
  plan: SetupPlan;
  token: string;
  expire: () => void;
}) {
  const [cursor, setCursor] = useState<string>();
  const slug = plan.project.slug;
  const load = useCallback(
    (signal: AbortSignal) =>
      cursor
        ? api.marketplace({ project: slug, cursor, limit: 20 }, token, signal)
        : Promise.resolve(plan.optional),
    [cursor, slug, token, plan],
  );
  const { state, retry } = useResource(
    `${slug}:${cursor ?? "first"}`,
    load,
    expire,
  );
  return (
    <section
      className="panel setup-instructions"
      aria-labelledby="optionals-title"
    >
      <h2 id="optionals-title">Complementos opcionais</h2>
      <p>
        Seu ambiente pode começar apenas com o pacote base. Para incluir um
        complemento no setup, use --include-optional
        nome-do-pacote,outro-pacote. Baixar no navegador não instala o pacote.
      </p>
      {state.status === "loading" ? (
        <Loading label="Carregando complementos…" />
      ) : state.status === "error" ? (
        <RequestError error={state.error} retry={retry} />
      ) : (
        <>
          {state.data.items.length === 0 ? (
            <p>Nenhum complemento nesta página.</p>
          ) : (
            <ul>
              {state.data.items.map((item) => (
                <li key={item.plugin.name}>
                  <a
                    href={packagePath(item.plugin.name, { project: slug })}
                    onClick={followLink}
                  >
                    {item.plugin.name}
                  </a>{" "}
                  · v{item.version.version}
                  <p>{item.version.description || item.plugin.description}</p>
                </li>
              ))}
            </ul>
          )}
          <div className="token-pagination">
            {cursor && (
              <Button variant="secondary" onClick={() => setCursor(undefined)}>
                Primeira página de complementos
              </Button>
            )}
            {state.data.next_cursor && (
              <Button
                variant="secondary"
                onClick={() => setCursor(state.data.next_cursor ?? undefined)}
              >
                Próxima página de complementos
              </Button>
            )}
          </div>
        </>
      )}
      <a
        className="text-link"
        href={marketplacePath({ project: slug })}
        onClick={followLink}
      >
        Explorar complementos no Marketplace
      </a>
    </section>
  );
}
