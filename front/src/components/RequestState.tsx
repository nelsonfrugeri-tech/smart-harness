import { ApiError } from "../api/client";
import { Button } from "./Primitives";
import { navigate } from "../app/navigation";
export function Loading({
  label = "Carregando seu workspace…",
}: {
  label?: string;
}) {
  return (
    <div className="request-state" role="status">
      <span className="loading-dot" />
      {label}
    </div>
  );
}
export function Unavailable({ correlationId }: { correlationId?: string }) {
  return (
    <div className="panel request-error" role="alert">
      <h2>Conteúdo indisponível</h2>
      <p>Este conteúdo não está disponível para sua conta.</p>
      {correlationId && (
        <details>
          <summary>Informações para suporte</summary>
          <code>{correlationId}</code>
        </details>
      )}
      <Button variant="secondary" onClick={() => navigate("/workspace")}>
        Voltar ao workspace
      </Button>
    </div>
  );
}
export function RequestError({
  error,
  retry,
}: {
  error: ApiError;
  retry: () => void;
}) {
  if (error.status === 403 || error.status === 404)
    return <Unavailable correlationId={error.correlationId} />;
  return (
    <div className="panel request-error" role="alert">
      <h2>Não foi possível carregar</h2>
      <p>
        {error.code === "timeout"
          ? "A resposta demorou mais que o esperado. Tente novamente."
          : "Não conseguimos acessar a API. Verifique a conexão e tente novamente."}
      </p>
      {error.correlationId && (
        <details>
          <summary>Informações para suporte</summary>
          <code>{error.correlationId}</code>
        </details>
      )}
      <Button variant="secondary" onClick={retry}>
        Tentar novamente
      </Button>
    </div>
  );
}
