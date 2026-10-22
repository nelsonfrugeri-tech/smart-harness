import type { SetupPlan } from "../api/client";
import { CopyValue } from "./CopyValue";
export function DemoCheckout() {
  return (
    <div className="demo-checkout">
      <h4>Abra o checkout da TOTVS</h4>
      <p>
        Use uma pasta nova, com Git, Node.js 24 e npm. Execute o setup e abra as
        sessões de desenvolvimento e review dentro de md2poui.
      </p>
      <CopyValue
        label="Comandos do checkout"
        value={
          "git clone --branch demo-start https://github.com/nelsonfrugeri-tech/md2poui.git\ncd md2poui\nnpm ci --ignore-scripts\nnpm test"
        }
      />
    </div>
  );
}
export function DemoSessions({ plan }: { plan: SetupPlan }) {
  const agents = plan.baseline
    .filter((item) => item.plugin.name === "md2poui-base")
    .flatMap((item) =>
      item.components
        .filter((component) => component.kind === "agent")
        .map((component) => ({
          name: component.name,
          command: `claude --agent '${item.plugin.name}:${component.name}'`,
        })),
    );
  return (
    <div className="demo-sessions">
      <h4>Desenvolva e revise no fork</h4>
      <p>
        No checkout md2poui, peça ao agente para ler a história no Trello e a
        ADR vinculada no Notion antes de alterar código. Use Graphify para
        navegar e deja-vu para recuperar o histórico real da preparação.
      </p>
      {(
        [
          ["developer", "desenvolvimento"],
          ["reviewer", "review"],
        ] as const
      ).map(([name, label]) => {
        const agent = agents.find((item) => item.name === name);
        return agent ? (
          <CopyValue
            key={name}
            label={`Abrir ${label}`}
            value={agent.command}
          />
        ) : (
          <p key={name}>
            O agente de {label} ainda não está no plano. Confira os pacotes
            publicados e recarregue a página.
          </p>
        );
      })}
      <p>
        Abra o review em outra sessão após a criação do PR. Corrija BLOCKER e
        MAJOR, repita os testes e faça merge somente no fork após a revisão. As
        credenciais de GitHub, Trello e Notion são preparadas no gateway; esta
        página não confirma a conexão com esses serviços.
      </p>
    </div>
  );
}

export function DemoTools() {
  return (
    <div className="demo-tools">
      <h4>Prepare Graphify e deja-vu</h4>
      <p>
        A CLI precisa oferecer <code>harness tools check</code>. Graphify requer
        uv e Python ≥ 3.10; deja-vu requer Go ≥ 1.25. Instale os binários locais
        e confira o resultado no terminal antes de executar o setup.
      </p>
      <CopyValue
        label="Comandos das ferramentas"
        value={"harness tools install graphify\nharness tools install deja-vu"}
      />
      <CopyValue label="Verificar ferramentas" value="harness tools check" />
    </div>
  );
}
