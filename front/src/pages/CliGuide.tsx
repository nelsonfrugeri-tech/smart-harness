import { useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ExternalLink,
  KeyRound,
  Terminal,
  Workflow,
} from "lucide-react";
import {
  CLAUDE_GATEWAY_URL,
  CLAUDE_SETUP_URL,
  cliCommands,
  installerCommand,
  recommendedPlugins,
} from "../app/cliCommands";
import { OBSERVABILITY_VIEWER_URL } from "../app/observability";
import { CopyValue } from "../components/CopyValue";
import { followLink } from "../components/Shell";
declare const __HARNESS_PUBLIC_API_URL__: string;
const steps = [
  ["token", "Seu token"],
  ["install", "Instalar e conectar"],
  ["develop", "Desenvolver"],
] as const;
export function CliGuide() {
  return (
    <div className="page cli-page">
      <header className="cli-hero">
        <div>
          <span className="eyebrow">COMEÇAR COM SMART HARNESS</span>
          <h1>
            Do seu perfil
            <br />
            ao terminal.
          </h1>
          <p>
            Seu contexto, suas ferramentas e suas skills.
            <br />
            Prepare uma vez. Desenvolva no seu repositório.
          </p>
          <a className="button button-primary" href="#token">
            Começar configuração <ArrowRight size={16} aria-hidden="true" />
          </a>
        </div>
        <div className="cli-hero-terminal" aria-hidden="true">
          <div>
            <i />
            <i />
            <i />
            <span>seu terminal</span>
          </div>
          <p>
            <span>$</span> harness doctor
          </p>
          <p className="terminal-preview-caption">Um comando. Seu ambiente.</p>
          <Terminal size={44} strokeWidth={1} />
        </div>
      </header>
      <nav className="cli-step-nav" aria-label="Etapas da configuração">
        {steps.map(([id, title], index) => (
          <a key={id} href={`#${id}`}>
            <span>{index + 1}</span>
            {title}
          </a>
        ))}
      </nav>
      <div className="cli-layout">
        <div className="cli-steps">
          <GuideStep
            id="token"
            number={1}
            title="Crie seu token pessoal"
            icon={<KeyRound size={21} />}
          >
            <p>
              Você já entrou na plataforma. Agora crie uma credencial para este
              dispositivo em seu perfil. Guarde o segredo para o prompt seguro
              da CLI.
            </p>
            <a
              className="button button-secondary"
              href="/profile#tokens"
              onClick={followLink}
            >
              Ir para meus tokens <ArrowRight size={15} aria-hidden="true" />
            </a>
          </GuideStep>
          <InstallStep />
          <GuideStep
            id="develop"
            number={3}
            title="Abra seu repositório. Comece."
            icon={<Workflow size={21} />}
          >
            <p>
              No terminal, entre na pasta do seu código. Confira o diagnóstico
              antes de abrir o Claude Code. Se houver falha, siga a orientação
              indicada pela CLI.
            </p>
            <CopyValue
              label="Diagnóstico do ambiente"
              value={cliCommands.doctor}
            />
            <div className="cli-note">
              <strong>Se instalou Graphify</strong>
              <p>
                Dentro do repositório, gere o grafo antes de abrir o Claude
                Code. O comando abaixo usa a pasta de código src; ajuste o
                caminho se suas fontes estiverem em outra pasta. O MCP precisa
                encontrar graphify-out/graph.json ou src/graphify-out/graph.json
                na pasta em que você abrir o Claude Code.
              </p>
              <CopyValue
                label="Preparar grafo local"
                value={cliCommands.graphify}
              />
              <p>
                Se o Claude Code já estiver aberto, reconecte o MCP do Graphify
                após gerar o grafo.
              </p>
            </div>
            <p>
              Use OpenRouter pelo gateway nesta sessão, com openrouter/free por
              padrão. O comando abaixo configura apenas o processo iniciado.
              Para usar sua conta Claude, abra com claude normalmente.
            </p>
            <CopyValue
              label="Abrir Claude Code com OpenRouter"
              value={cliCommands.start}
            />
            <p>
              Esse comando também sobe o visualizador de traces do claude-tap em{" "}
              {OBSERVABILITY_VIEWER_URL}, só nesta máquina. Acompanhe as
              requisições na página Observabilidade.
            </p>
            <a className="text-link" href="/observability" onClick={followLink}>
              Abrir Observabilidade <ArrowRight size={15} aria-hidden="true" />
            </a>
            <p>
              Para revisar uma mudança, repita o comando acima em outro
              terminal, no mesmo repositório. Dentro dessa nova sessão, invoque
              a skill do plugin code-review instalado e indique o diff ou PR a
              revisar.
            </p>
            <CopyValue
              label="Invocar skill dentro do Claude Code"
              value={cliCommands.reviewSkill}
            />
          </GuideStep>
        </div>
        <aside className="cli-companion">
          <span className="eyebrow">NO SEU RITMO</span>
          <h2>Continue de onde parou.</h2>
          <p>
            Os passos são independentes. Pule o que você já preparou e confira
            os resultados no terminal.
          </p>
          <a href="#install">
            Já criei meu token <ArrowRight size={14} aria-hidden="true" />
          </a>
          <a href="#develop">
            Já conectei o ambiente <ArrowRight size={14} aria-hidden="true" />
          </a>
          <div className="cli-companion-note">
            <strong>O terminal confirma.</strong>
            <p>
              Copiar um comando não instala plugins nem confirma uma conexão.
              Esta página não acompanha sua máquina.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
function GuideStep({
  id,
  number,
  title,
  icon,
  children,
}: {
  id: string;
  number: number;
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      tabIndex={-1}
      className="panel cli-step"
      aria-labelledby={`${id}-title`}
    >
      <div className="cli-step-heading">
        <span className="cli-step-icon" aria-hidden="true">
          {icon}
        </span>
        <div>
          <span className="eyebrow">
            PASSO {String(number).padStart(2, "0")}
          </span>
          <h2 id={`${id}-title`}>{title}</h2>
        </div>
      </div>
      <div className="cli-step-content">{children}</div>
    </section>
  );
}
function InstallStep() {
  const [url, setURL] = useState(__HARNESS_PUBLIC_API_URL__);
  const command = installerCommand(url);
  return (
    <GuideStep
      id="install"
      number={2}
      title="Um comando. Seu ambiente conectado."
      icon={<ArrowDownToLine size={21} />}
    >
      <p>
        O instalador detecta seu sistema, verifica o download e configura a CLI,
        o gateway e os Tools e Skills disponíveis para sua conta. Quando o
        terminal pedir, cole o token pessoal no prompt sem eco. O login também
        instala a observabilidade local (claude-tap), que grava as requisições
        do Claude Code apenas nesta máquina.
      </p>
      <details className="cli-note cli-prerequisites">
        <summary>Antes de começar: pré-requisitos</summary>
        <p>
          Tenha Claude Code e curl no PATH. Funciona em macOS e Linux, com ARM64
          ou x64. No Windows, execute dentro do WSL.
        </p>
        <a
          className="text-link"
          href={CLAUDE_SETUP_URL}
          target="_blank"
          rel="noopener"
        >
          Instalação oficial do Claude Code{" "}
          <ExternalLink size={15} aria-hidden="true" />
        </a>
        <p>
          Para instalar Graphify, tenha uv e Python ≥ 3.10. Para deja-vu, tenha
          Go ≥ 1.25. O instalador prepara os runtimes dessas ferramentas quando
          esses pré-requisitos estão disponíveis.
        </p>
        <p>
          O token pessoal autoriza o gateway e os MCPs. Instalar, fazer login ou
          sincronizar o Harness preserva sua conta Claude e não define um
          provedor ou modelo global. Use harness vendor=claude para abrir uma
          sessão via OpenRouter; use claude para sua conta Claude.
        </p>
        <a href={CLAUDE_GATEWAY_URL} target="_blank" rel="noopener">
          Como funciona a conexão por gateway
        </a>
      </details>
      <label className="cli-url">
        URL da plataforma
        <input
          type="url"
          value={url}
          onChange={(event) => setURL(event.target.value)}
          autoComplete="off"
        />
      </label>
      {command ? (
        <CopyValue
          key={command}
          label="Instalar e configurar"
          value={command}
        />
      ) : (
        <p className="notice form-error" role="alert">
          Use HTTPS sem credenciais, query ou fragmento. HTTP é permitido apenas
          em localhost.
        </p>
      )}
      <p className="cli-fine-print">
        O token não faz parte do comando. Ao terminar, siga a orientação do
        instalador para atualizar o PATH neste terminal, se necessário.
      </p>
      <div className="cli-plugin-chips" aria-label="Pacotes da demo">
        {recommendedPlugins.map((name) => (
          <a
            key={name}
            href={`/marketplace/packages/${name}`}
            onClick={followLink}
          >
            {name}
          </a>
        ))}
      </div>
      <div className="cli-note">
        <strong>Instalação parcial? Continue pelo terminal.</strong>
        <p>
          Se faltar um pré-requisito ou um pacote falhar, o login e os pacotes
          já configurados são preservados. Siga os comandos de recuperação
          exibidos pela CLI e confira o diagnóstico antes de desenvolver.
        </p>
      </div>
      <a className="text-link" href="/marketplace" onClick={followLink}>
        Explorar Tools, Skills e Agents{" "}
        <ArrowRight size={15} aria-hidden="true" />
      </a>
    </GuideStep>
  );
}
