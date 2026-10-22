import type { PluginItem } from "../api/client";
import { CopyValue } from "./CopyValue";
import { followLink } from "./Shell";
const installGroups = {
  connector: "tools",
  skill: "skills",
  agent: "agents",
} as const;
const commandName = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
export function PackageInstall({ item }: { item: PluginItem }) {
  if (!commandName.test(item.plugin.name)) return null;
  const agents = item.components.filter(
    (component) =>
      component.kind === "agent" && commandName.test(component.name),
  );
  return (
    <section
      className="panel package-install"
      aria-labelledby="install-package-title"
    >
      <h2 id="install-package-title">Usar no Claude Code</h2>
      <p>
        Execute no terminal depois de conectar o CLI. A instalação usa a versão
        mais recente disponível para sua conta.
      </p>
      <CopyValue
        label="Comando de instalação"
        value={`harness ${installGroups[item.type]} install ${item.plugin.name}`}
      />
      {agents.map((agent) => (
        <CopyValue
          key={agent.name}
          label={`Iniciar ${agent.name}`}
          value={`harness vendor=claude --agent ${item.plugin.name}:${agent.name}`}
        />
      ))}
      {agents.length > 0 && (
        <p>
          Abra o agent dentro da pasta do projeto. O launcher usa OpenRouter
          nesta sessão; para usar sua conta Claude, troque{" "}
          <code>harness vendor=claude</code> por <code>claude</code>.
        </p>
      )}
      <a className="text-link" href="/cli" onClick={followLink}>
        Ainda não tem o CLI? Veja como instalar
      </a>
    </section>
  );
}
