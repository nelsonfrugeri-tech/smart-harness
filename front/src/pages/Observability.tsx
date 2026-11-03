import { ExternalLink, RefreshCw } from "lucide-react";
import { cliCommands } from "../app/cliCommands";
import { OBSERVABILITY_VIEWER_URL, probeViewer } from "../app/observability";
import { useResource } from "../app/useResource";
import { CopyValue } from "../components/CopyValue";
import { Button, EmptyState, PageHeading } from "../components/Primitives";
import { Loading } from "../components/RequestState";
// The probe never answers 401; the session is not involved.
const ignoreUnauthorized = () => {};
export function Observability() {
  const { state, retry } = useResource(
    "viewer",
    probeViewer,
    ignoreUnauthorized,
  );
  return (
    <div className="page observability-page">
      <PageHeading
        eyebrow="OBSERVABILIDADE"
        title="Traces do Claude Code"
        description="Cada requisição do Claude Code gravada pelo claude-tap: system prompt, mensagens, tools, chamadas e resultados, tokens e o diff entre requisições."
        action={
          <a
            className="button button-secondary"
            href={OBSERVABILITY_VIEWER_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Abrir em nova aba <ExternalLink size={15} aria-hidden="true" />
          </a>
        }
      />
      <p className="observability-privacy">
        Os traces ficam só na sua máquina e nada vai para o servidor: só você vê
        os seus.
      </p>
      <section
        className="observability-viewer"
        aria-label="Visualizador de traces"
      >
        {state.status === "loading" ? (
          <Loading label="Verificando o visualizador local…" />
        ) : state.status === "success" ? (
          <>
            <iframe
              className="observability-frame"
              title="Visualizador de traces do claude-tap"
              src={OBSERVABILITY_VIEWER_URL}
              referrerPolicy="no-referrer"
            />
            <p className="observability-fine-print">
              Se o visualizador não aparecer aqui, use “Abrir em nova aba”.
            </p>
          </>
        ) : (
          <>
            <EmptyState
              title="Visualizador não encontrado"
              description={`Nada responde em ${OBSERVABILITY_VIEWER_URL}. Abra o Claude Code com ${cliCommands.start} e verifique novamente.`}
            />
            <Button variant="secondary" onClick={retry}>
              <RefreshCw size={15} aria-hidden="true" /> Verificar novamente
            </Button>
          </>
        )}
      </section>
      <section
        className="panel observability-how"
        aria-labelledby="traces-how-title"
      >
        <h2 id="traces-how-title">Como gerar traces</h2>
        <p>
          No seu repositório, abra o Claude Code pela CLI. O claude-tap grava
          cada requisição e sobe o visualizador em {OBSERVABILITY_VIEWER_URL}.
        </p>
        <CopyValue
          label="Abrir Claude Code com traces"
          value={cliCommands.start}
        />
      </section>
    </div>
  );
}
