import { useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ExternalLink,
  KeyRound,
  Package,
  Terminal,
  Workflow,
} from "lucide-react";
import {
  CLAUDE_GATEWAY_URL,
  CLAUDE_SETUP_URL,
  CLI_RELEASE_URL,
  CLI_RELEASE_VERSION,
  CLI_DOWNLOAD_URL,
  cliCommands,
  loginCommand,
  recommendedPlugins,
} from "../app/cliCommands";
import { CopyValue } from "../components/CopyValue";
import { followLink } from "../components/Shell";
declare const __HARNESS_PUBLIC_API_URL__: string;
const steps = [
  ["token", "Seu token"],
  ["download", "Baixar CLI"],
  ["connect", "Conectar"],
  ["claude", "Claude Code"],
  ["plugins", "Seus plugins"],
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
            Seu contexto, suas ferramentas e seus agentes.
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
          <p className="terminal-preview-caption">
            Conecte. Escolha. Desenvolva.
          </p>
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
          <DownloadStep />
          <ConnectStep />
          <ClaudeStep />
          <GuideStep
            id="plugins"
            number={5}
            title="Escolha o que vai com você"
            icon={<Package size={21} />}
          >
            <p>
              Explore conectores, skills e agentes no Marketplace. Este conjunto
              prepara o fluxo de desenvolvimento e review.
            </p>
            <div className="cli-plugin-chips">
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
              <strong>Prepare as ferramentas locais</strong>
              <p>
                Graphify precisa de uv e Python ≥ 3.10. Deja-vu precisa de Go ≥
                1.25. Instale as ferramentas antes dos plugins que as utilizam.
              </p>
            </div>
            <CopyValue
              label="Preparar ferramentas locais"
              value={cliCommands.tools}
            />
            <CopyValue
              label="Instalar plugins"
              value={cliCommands.installPlugins}
            />
            <a className="text-link" href="/marketplace" onClick={followLink}>
              Explorar o Marketplace <ArrowRight size={15} aria-hidden="true" />
            </a>
          </GuideStep>
          <GuideStep
            id="develop"
            number={6}
            title="Abra seu repositório. Comece."
            icon={<Workflow size={21} />}
          >
            <p>
              No terminal, entre na pasta do seu código. Confira o diagnóstico
              antes de iniciar os agentes. Se houver falha, siga a orientação
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
            <CopyValue
              label="Iniciar desenvolvimento"
              value={cliCommands.developer}
            />
            <p>
              Para revisar uma mudança, abra uma sessão independente no mesmo
              repositório.
            </p>
            <CopyValue
              label="Iniciar code review"
              value={cliCommands.reviewer}
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
          <a href="#connect">
            Pular download <ArrowRight size={14} aria-hidden="true" />
          </a>
          <a href="#plugins">
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
function DownloadStep() {
  const [os, setOS] = useState("darwin");
  const [arch, setArch] = useState("arm64");
  const filename = `harness-${CLI_RELEASE_VERSION}-${os}-${arch}`;
  return (
    <GuideStep
      id="download"
      number={2}
      title="Leve a CLI para seu terminal"
      icon={<ArrowDownToLine size={21} />}
    >
      <p>
        Escolha seu sistema e arquitetura. Na release, baixe o binário indicado
        e o arquivo SHA256SUMS para conferir a integridade.
      </p>
      <div className="cli-platform">
        <label>
          Sistema operacional
          <select value={os} onChange={(event) => setOS(event.target.value)}>
            <option value="darwin">macOS</option>
            <option value="linux">Linux</option>
          </select>
        </label>
        <label>
          Arquitetura
          <select
            value={arch}
            onChange={(event) => setArch(event.target.value)}
          >
            <option value="arm64">ARM64 · Apple Silicon / ARM</option>
            <option value="amd64">x64 · Intel / AMD</option>
          </select>
        </label>
      </div>
      <div className="cli-download-file">
        <code>{filename}</code>
        <a
          className="button button-primary"
          href={`${CLI_DOWNLOAD_URL}/${filename}`}
          target="_blank"
          rel="noopener"
        >
          Baixar CLI <ExternalLink size={15} aria-hidden="true" />
        </a>
      </div>
      <p className="cli-fine-print">
        O download pode exigir acesso no GitHub. No Windows, use o binário Linux
        dentro do WSL.
      </p>
      <div className="cli-download-links">
        <a
          href={`${CLI_DOWNLOAD_URL}/SHA256SUMS`}
          target="_blank"
          rel="noopener"
        >
          Baixar SHA256SUMS
        </a>
        <a href={CLI_RELEASE_URL} target="_blank" rel="noopener">
          Ver release {CLI_RELEASE_VERSION}
        </a>
      </div>
      <p>
        Na pasta onde salvou os dois arquivos, confira o checksum. Depois
        instale o binário em seu PATH.
      </p>
      <CopyValue
        label="Instalar CLI no terminal"
        value={`shasum -a 256 -c --ignore-missing SHA256SUMS &&
chmod +x ${filename} &&
mkdir -p ~/.local/bin &&
mv ${filename} ~/.local/bin/harness &&
export PATH="$HOME/.local/bin:$PATH" &&
harness version`}
      />
      <a className="text-link" href="#connect">
        Já tenho a CLI <ArrowRight size={15} aria-hidden="true" />
      </a>
    </GuideStep>
  );
}
function ConnectStep() {
  const [url, setURL] = useState(__HARNESS_PUBLIC_API_URL__);
  const command = loginCommand(url);
  return (
    <GuideStep
      id="connect"
      number={3}
      title="Conecte sua conta à CLI"
      icon={<KeyRound size={21} />}
    >
      <p>
        Confira o endereço da plataforma. Execute o comando e cole o token no
        prompt sem eco; o segredo não faz parte do comando.
      </p>
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
        <CopyValue key={command} label="Conectar CLI" value={command} />
      ) : (
        <p className="notice form-error" role="alert">
          Use HTTPS sem credenciais, query ou fragmento. HTTP é permitido apenas
          em localhost.
        </p>
      )}
    </GuideStep>
  );
}

function ClaudeStep() {
  return (
    <GuideStep
      id="claude"
      number={4}
      title="Conecte o Claude Code"
      icon={<Terminal size={21} />}
    >
      <p>
        Instale o Claude Code conforme seu sistema. Se já está instalado,
        confira a versão e avance.
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
      <CopyValue label="Verificar Claude Code" value="claude --version" />
      <div className="cli-note">
        <strong>Uma credencial para esta conexão</strong>
        <p>
          Nesta jornada, o Smart Harness configura o acesso pelo gateway com seu
          token pessoal. Não é necessário fazer um segundo login na Anthropic.
          Uma assinatura pessoal do Claude é uma forma diferente de acesso.
        </p>
        <a href={CLAUDE_GATEWAY_URL} target="_blank" rel="noopener">
          Como funciona a conexão por gateway
        </a>
      </div>
      <a className="text-link" href="#plugins">
        Já tenho Claude Code <ArrowRight size={15} aria-hidden="true" />
      </a>
    </GuideStep>
  );
}
