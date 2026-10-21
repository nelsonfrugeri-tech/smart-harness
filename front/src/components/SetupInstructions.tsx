import { useEffect, useRef, useState } from "react";
import type { SetupPlan } from "../api/client";
import { CopyValue } from "./CopyValue";
import { followLink } from "./Shell";
declare const __HARNESS_PUBLIC_API_URL__: string;
// The published CLI release; the repository is private, so the page asks for GitHub access.
const CLI_RELEASE_URL =
  "https://github.com/nelsonfrugeri-tech/smart-harness/releases/tag/v0.1.0";
function terminalURL(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    )
      return;
    return url.toString().replace(/\/$/, "");
  } catch {
    return;
  }
}
function quote(value: string) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
export function SetupInstructions({ plan }: { plan: SetupPlan }) {
  const [apiURL, setApiURL] = useState(__HARNESS_PUBLIC_API_URL__);
  const url = terminalURL(apiURL);
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    if (location.hash === "#setup") {
      section.current?.focus();
      section.current?.scrollIntoView?.();
    }
  }, []);
  return (
    <section
      ref={section}
      id="setup"
      tabIndex={-1}
      className="panel setup-instructions"
      aria-labelledby="setup-title"
    >
      <div className="setup-heading">
        <span className="eyebrow">SEU PRÓXIMO PASSO</span>
        <h2 id="setup-title">Prepare o ambiente para {plan.project.name}</h2>
        <p>
          Siga os passos no seu terminal. Copiar um comando não instala nem
          confirma a saúde do ambiente.
        </p>
      </div>
      <ol className="setup-steps">
        <li>
          <div className="setup-step-number" aria-hidden="true">
            1
          </div>
          <div className="setup-step-body">
            <h3>Instale a CLI</h3>
            <p>
              Baixe o <code>harness</code> para sua plataforma na{" "}
              <a href={CLI_RELEASE_URL} target="_blank" rel="noopener">
                release v0.1.0 da CLI
              </a>
              , confira <code>SHA256SUMS</code> e coloque o binário no PATH.
              Você também precisa do Claude Code ≥ 2.1.305.
            </p>
            <p>
              Confira <code>harness version</code>. O roteiro completo está em{" "}
              <code>docs/onboarding.md</code>.
            </p>
          </div>
        </li>
        <li>
          <div className="setup-step-number" aria-hidden="true">
            2
          </div>
          <div className="setup-step-body">
            <h3>Crie seu token pessoal</h3>
            <p>
              O segredo aparece uma única vez. Guarde-o para o prompt seguro do
              setup; nunca o inclua no comando.
            </p>
            <a
              className="button button-secondary"
              href={`/profile/tokens?project=${encodeURIComponent(plan.project.slug)}`}
              onClick={followLink}
            >
              Meus tokens
            </a>
          </div>
        </li>
        <li>
          <div className="setup-step-number" aria-hidden="true">
            3
          </div>
          <div className="setup-step-body">
            <h3>Execute o setup do projeto</h3>
            <p>
              Confirme a URL da API acessível pelo seu terminal. No primeiro
              uso, sem SMART_HARNESS_TOKEN nem credencial salva, cole o token no
              prompt sem eco.
            </p>
            <label className="setup-url">
              URL da API para a CLI
              <input
                type="url"
                value={apiURL}
                onChange={(event) => setApiURL(event.target.value)}
                autoComplete="off"
              />
            </label>
            {!url ? (
              <p role="alert">
                Informe uma URL HTTPS sem credenciais, query ou fragmento. HTTP
                é permitido somente em loopback.
              </p>
            ) : (
              <CopyValue
                key={url}
                label="Comando de setup"
                value={`harness setup ${quote(plan.project.slug)} --api-url ${quote(url)}`}
              />
            )}
            <details>
              <summary>O que o setup configura?</summary>
              <p>
                O setup consulta o plano atual da API e instala suas versões
                fixadas. Se o plano mudar, recarregue a página para conferir a
                composição. O gateway é <code>{plan.gateway.url}</code>,
                separado da API. O token é salvo em{" "}
                <code>~/.claude/settings.json</code>, com permissões restritas,
                e reutilizado pela CLI.
              </p>
            </details>
          </div>
        </li>
        <li>
          <div className="setup-step-number" aria-hidden="true">
            4
          </div>
          <div className="setup-step-body">
            <h3>Verifique no terminal</h3>
            <p>
              Após o setup, execute o diagnóstico e abra o agente com o comando
              informado pela CLI.
            </p>
            <CopyValue label="Comando de diagnóstico" value="harness doctor" />
            <p>
              Doctor verifica Claude Code, API, token, gateway, settings,
              plugins e plano. Se aparecer <code>FAIL</code>, siga o{" "}
              <code>fix:</code> e repita. Esta página não recebe os resultados
              do terminal.
            </p>
          </div>
        </li>
      </ol>
      <details className="setup-maintenance">
        <summary>Atualizar o ambiente depois</summary>
        <p>Sync aplica o plano atual de todos os projetos configurados.</p>
        <CopyValue label="Comando de atualização" value="harness sync" />
      </details>
    </section>
  );
}
