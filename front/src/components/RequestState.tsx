import { ApiError } from "../api/client";
import { Button, EmptyState } from "./Primitives";
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
export function Unavailable() {
  return (
    <EmptyState
      title="Projeto indisponível"
      description="Este projeto não está disponível para sua conta."
    />
  );
}
export function RequestError({
  error,
  retry,
}: {
  error: ApiError;
  retry: () => void;
}) {
  const unavailable = error.status === 403 || error.status === 404;
  return (
    <div className="panel request-error" role="alert">
      <h2>
        {unavailable ? "Conteúdo indisponível" : "Não foi possível carregar"}
      </h2>
      <p>
        {unavailable
          ? "Este conteúdo não está disponível para sua conta."
          : error.code === "timeout"
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
