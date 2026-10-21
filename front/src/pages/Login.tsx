import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { api, ApiError, type Me } from "../api/client";
import { Button } from "../components/Primitives";
export function Login({
  onLogin,
  expired,
}: {
  onLogin: (token: string, identity: Me) => void;
  expired: boolean;
}) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.login(email.trim(), controller.signal);
      const identity = await api.me(result.access_token, controller.signal);
      if (!controller.signal.aborted) onLogin(result.access_token, identity);
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof ApiError
            ? failure
            : new ApiError(0, "network_error"),
        );
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-intro">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            smart<span className="brand-light">harness</span>
          </span>
        </div>
        <span className="eyebrow">SEU CONTEXTO DE DESENVOLVIMENTO</span>
        <h1>Bom trabalho começa com contexto.</h1>
        <p>
          Encontre os agentes, skills e integrações dos seus projetos em um só
          lugar.
        </p>
      </section>
      <section className="login-panel panel">
        <span className="eyebrow">AMBIENTE LOCAL</span>
        <h2>Entre no seu workspace</h2>
        <p>Use o email cadastrado no ambiente de desenvolvimento.</p>
        {expired && (
          <p role="status" className="notice">
            Sua sessão expirou. Entre novamente.
          </p>
        )}
        <form onSubmit={submit} aria-busy={busy}>
          <label className="form-field">
            Email
            <input
              autoComplete="email"
              type="email"
              maxLength={254}
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-describedby={error ? "login-error" : undefined}
            />
          </label>
          {error && (
            <div role="alert" id="login-error" className="form-error">
              <p>{loginError(error)}</p>
              {error.correlationId && (
                <details>
                  <summary>Informações para suporte</summary>
                  <code>{error.correlationId}</code>
                </details>
              )}
            </div>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? "Entrando…" : "Entrar"}
            <ArrowRight size={16} />
          </Button>
        </form>
        <small>
          Login de desenvolvimento, disponível somente no ambiente local.
        </small>
      </section>
    </main>
  );
}
function loginError(error: ApiError) {
  if (error.code === "unknown_user")
    return "Email não cadastrado. Confira o endereço ou solicite acesso ao ambiente.";
  if (error.status === 400) return "Confira o email informado.";
  if (error.status === 401)
    return "Não foi possível confirmar sua sessão. Tente entrar novamente.";
  if (error.status === 404)
    return "O login local não está habilitado neste ambiente.";
  return "Não foi possível acessar a API. Verifique a conexão e tente novamente.";
}
