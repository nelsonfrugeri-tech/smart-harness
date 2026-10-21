import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  api,
  ApiError,
  type GatewayToken,
  type GatewayTokenCreated,
} from "../api/client";
import { useResource } from "../app/useResource";
import { Button, EmptyState, PageHeading } from "../components/Primitives";
import { Loading, RequestError } from "../components/RequestState";
import { CopyValue } from "../components/CopyValue";
interface Props {
  token: string;
  expire: () => void;
}
export function GatewayTokens({ token, expire }: Props) {
  const [cursor, setCursor] = useState<string>();
  const [created, setCreated] = useState<GatewayTokenCreated>();
  const [selected, setSelected] = useState<GatewayToken>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const confirmation = useRef<HTMLHeadingElement>(null);
  const revokeOrigin = useRef<string | undefined>(undefined);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => {
    if (selected) confirmation.current?.focus();
    else if (revokeOrigin.current) {
      const origin = document.getElementById(`revoke-${revokeOrigin.current}`);
      (origin ?? input.current)?.focus();
      revokeOrigin.current = undefined;
    }
  }, [selected]);
  useEffect(() => {
    if (!created) input.current?.focus();
  }, [created]);
  const load = useCallback(
    (signal: AbortSignal) => api.gatewayTokens(cursor, token, signal),
    [cursor, token],
  );
  const { state, retry } = useResource(cursor ?? "first", load, expire);
  async function mutate(action: (signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError(undefined);
    setNotice("");
    try {
      await action(controller.signal);
      if (!controller.signal.aborted) {
        setCursor(undefined);
        retry();
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      const failure =
        cause instanceof ApiError ? cause : new ApiError(0, "network_error");
      if (failure.status === 401) expire();
      else setError(failure);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  function create(event: FormEvent) {
    event.preventDefault();
    if (busy || !name.trim()) return;
    void mutate(async (signal) => {
      const result = await api.createGatewayToken(name.trim(), token, signal);
      if (!signal.aborted) {
        setCreated(result);
        setName("");
      }
    });
  }
  function revoke() {
    if (!selected || busy) return;
    const target = selected;
    void mutate(async (signal) => {
      await api.revokeGatewayToken(target.id, token, signal);
      if (!signal.aborted) {
        setSelected(undefined);
        setNotice(`Token “${target.name}” revogado.`);
        input.current?.focus();
      }
    });
  }
  return (
    <div className="page tokens-page">
      <PageHeading
        title="Meus tokens"
        description="Credenciais pessoais para a CLI e o gateway. O segredo aparece somente na criação."
      />
      {created ? (
        <CreatedToken created={created} close={() => setCreated(undefined)} />
      ) : (
        <form className="panel token-form" onSubmit={create}>
          <h2>Criar token</h2>
          <label>
            Nome do token
            <input
              ref={input}
              required
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
              autoComplete="off"
            />
          </label>
          <Button type="submit" disabled={busy || !name.trim()}>
            Criar token
          </Button>
        </form>
      )}
      <p role="status">{busy ? "Enviando solicitação…" : notice}</p>
      {error && (
        <MutationError
          error={error}
          refresh={() => {
            setError(undefined);
            retry();
          }}
        />
      )}
      {selected && (
        <section className="panel" aria-labelledby="revoke-title">
          <h2 id="revoke-title" ref={confirmation} tabIndex={-1}>
            Revogar “{selected.name}”?
          </h2>
          <p>
            Identificador: <code>{selected.id}</code>. A CLI e o gateway
            deixarão de aceitar esta credencial.
          </p>
          <Button onClick={revoke} disabled={busy}>
            Confirmar revogação
          </Button>{" "}
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setSelected(undefined);
            }}
          >
            Cancelar
          </Button>
        </section>
      )}
      <h2>Seus tokens</h2>
      {state.status === "loading" ? (
        <Loading label="Carregando tokens…" />
      ) : state.status === "error" ? (
        <RequestError error={state.error} retry={retry} />
      ) : (
        <>
          {state.data.items.length === 0 ? (
            <EmptyState
              title="Nenhum token nesta página"
              description="Crie uma credencial para usar a CLI."
            />
          ) : (
            <TokenList
              items={state.data.items}
              disabled={busy || !!selected}
              select={(item) => {
                revokeOrigin.current = item.id;
                setSelected(item);
                setError(undefined);
              }}
            />
          )}
          <div className="token-pagination">
            {cursor && (
              <Button variant="secondary" onClick={() => setCursor(undefined)}>
                Primeira página
              </Button>
            )}
            {state.data.next_cursor && (
              <Button
                variant="secondary"
                onClick={() => setCursor(state.data.next_cursor ?? undefined)}
              >
                Próxima página
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TokenList({
  items,
  disabled,
  select,
}: {
  items: GatewayToken[];
  disabled: boolean;
  select: (item: GatewayToken) => void;
}) {
  return (
    <ul className="token-list">
      {items.map((item) => (
        <li className="panel" key={item.id}>
          <h3>{item.name}</h3>
          <small>Identificador: {item.id}</small>
          <p>
            Criado em {new Date(item.created_at).toLocaleString("pt-BR")} ·
            Expira em {new Date(item.expires_at).toLocaleString("pt-BR")}
          </p>
          {item.revoked_at ? (
            <p>
              Revogado em {new Date(item.revoked_at).toLocaleString("pt-BR")}
            </p>
          ) : (
            <Button
              id={`revoke-${item.id}`}
              variant="secondary"
              disabled={disabled}
              onClick={() => select(item)}
            >
              Revogar {item.name}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function CreatedToken({
  created,
  close,
}: {
  created: GatewayTokenCreated;
  close: () => void;
}) {
  const secret = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    secret.current?.focus();
  }, []);
  return (
    <section className="panel" aria-labelledby="secret-title">
      <h2 ref={secret} tabIndex={-1} id="secret-title">
        Guarde o token “{created.name}”
      </h2>
      <p>
        Esta é a única exibição. Use o prompt seguro de harness setup no
        terminal. Fechar remove o segredo desta tela.
      </p>
      <CopyValue label="Token" value={created.token} />
      <Button onClick={close}>Fechar segredo</Button>
    </section>
  );
}

function MutationError({
  error,
  refresh,
}: {
  error: ApiError;
  refresh: () => void;
}) {
  return (
    <div role="alert" className="notice form-error">
      <p>
        {error.status === 403 || error.status === 404
          ? "Token indisponível para sua conta. Atualize a lista."
          : "A operação não foi confirmada. Confira a lista antes de tentar novamente; uma criação pode ter sido processada pela API."}
      </p>
      <Button variant="secondary" onClick={refresh}>
        Atualizar lista
      </Button>
    </div>
  );
}
