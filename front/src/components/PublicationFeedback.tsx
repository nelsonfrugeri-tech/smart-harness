import type { ApiError, RepositorySync } from "../api/client";
import { packagePath } from "../app/marketplaceQuery";
import { followLink } from "./Shell";

export function PublicationError({ error }: { error: ApiError }) {
  let message =
    "Não conseguimos confirmar a publicação. Verifique a conexão e tente publicar a mesma versão novamente.";
  if (error.status === 403)
    message = "Você precisa ser ADMIN da squad para publicar este repositório.";
  else if (error.status === 404)
    message =
      "Este repositório não está disponível para sua conta. Confira o cadastro e seu acesso.";
  else if (error.code === "github_not_found")
    message =
      "Não encontramos o repositório ou a release. Confira a tag e o acesso ao GitHub configurado na plataforma.";
  else if (error.status === 409)
    message =
      "Este repositório ou versão já está registrado com outros dados. Confira a origem; se o conteúdo mudou, publique uma nova versão no GitHub.";
  else if (error.status === 422)
    message =
      "A release não passou na validação. Confira a versão do pacote e o arquivo .tar.gz anexado no GitHub.";
  else if (error.status === 400)
    message = "Confira o repositório, a squad e a tag informados.";
  else if (error.status === 502)
    message =
      "Não foi possível concluir o acesso ao GitHub. Confira a release e tente novamente.";
  return (
    <div className="publication-feedback publication-error" role="alert">
      <strong>Publicação não confirmada</strong>
      <p>{message}</p>
      <details>
        <summary>Informações para suporte</summary>
        <code>
          {error.code}
          {error.correlationId ? ` · ${error.correlationId}` : ""}
        </code>
      </details>
    </div>
  );
}
export function PublicationSuccess({ result }: { result: RepositorySync }) {
  return (
    <div className="publication-feedback publication-success" role="status">
      <strong>
        {result.status === "created"
          ? "Versão publicada"
          : "Versão já disponível"}
      </strong>
      <p>
        {result.plugin} · v{result.version}
      </p>
      <a
        className="text-link"
        href={packagePath(result.plugin, {})}
        onClick={followLink}
      >
        Ver pacote no Marketplace
      </a>
    </div>
  );
}
