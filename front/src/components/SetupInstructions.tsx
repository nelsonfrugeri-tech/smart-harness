import { useState } from "react";
import type { SetupPlan } from "../api/client";
import { CopyValue } from "./CopyValue";
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
  return (
    <section className="panel setup-instructions" aria-labelledby="setup-title">
      <h2 id="setup-title">Preparar no terminal</h2>
      <p>
        O navegador conhece o plano do projeto. A instalação e o diagnóstico
        acontecem na sua máquina; copiar um comando apenas copia o texto.
      </p>
      <ol>
        <li>
          Baixe o binário <code>harness</code> da sua plataforma na{" "}
          <a href={CLI_RELEASE_URL} target="_blank" rel="noopener">
            release v0.1.0 da CLI
          </a>
          , confira o <code>SHA256SUMS</code> e coloque o binário no PATH. O
          roteiro completo está em <code>docs/onboarding.md</code>. Tenha também
          o Claude Code ≥ 2.1.305, a versão mínima exercitada pelo projeto.
          Confira <code>harness version</code>.
        </li>
        <li>
          Abra{" "}
          <a href="/profile/tokens" target="_blank" rel="noopener">
            Meus tokens
          </a>{" "}
          em outra aba e crie sua credencial. Execute setup abaixo: no primeiro
          uso, sem SMART_HARNESS_TOKEN nem credencial salva, cole o segredo no
          prompt sem eco do terminal. Nunca cole o segredo no comando.
        </li>
        <li>
          Confirme a URL da API acessível pelo seu terminal. Ela é a origem do
          control-plane, separada da URL do gateway abaixo.
        </li>
      </ol>
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
          Informe uma URL HTTPS sem credenciais, query ou fragmento. HTTP é
          permitido somente em loopback.
        </p>
      ) : (
        <CopyValue
          key={url}
          label="Comando de setup"
          value={`harness setup ${quote(plan.project.slug)} --api-url ${quote(url)}`}
        />
      )}
      <p>
        O setup consulta o plano atual da API e instala suas versões fixadas. Se
        o plano mudar desde esta consulta, recarregue a página para conferir a
        composição. Ele aponta o Claude Code para{" "}
        <code>{plan.gateway.url}</code>. O token é salvo em{" "}
        <code>~/.claude/settings.json</code>, com permissões restritas; a CLI
        reutiliza essa credencial nos próximos comandos.
      </p>
      <p>
        Complementos são opcionais. Explore a lista abaixo; para instalar, use{" "}
        <code>--include-optional nome-do-pacote,outro-pacote</code> no setup.
        Selecionar ou baixar um pacote no browser não o instala.
      </p>
      <CopyValue label="Comando de diagnóstico" value="harness doctor" />
      <p>
        No terminal, setup informa os plugins aplicados e o comando para abrir o
        agente. Doctor verifica Claude Code, API, token, gateway, settings,
        plugins e plano. Saída <code>FAIL</code> traz <code>fix:</code>; corrija
        e repita. A interface não recebe esses resultados nem confirma
        instalação ou saúde das integrações.
      </p>
      <CopyValue label="Comando de atualização" value="harness sync" />
      <p>
        Sync aplica o plano atual de todos os projetos configurados. Use quando
        quiser atualizar seu ambiente.
      </p>
    </section>
  );
}
