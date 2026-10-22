import { CopyValue } from "./CopyValue";
export function PublicationGuide() {
  return (
    <details className="publication-guide">
      <summary>Primeira publicação? Veja como preparar o pacote</summary>
      <ol>
        <li>
          Crie um pacote com o Harness CLI 0.2.3 ou mais recente. Escolha{" "}
          <code>tool</code>, <code>skill</code> ou <code>agent</code>.
        </li>
        <li>Personalize o conteúdo e revise as mudanças em um PR no GitHub.</li>
        <li>
          Publique uma release com o arquivo do pacote e informe sua tag aqui.
        </li>
      </ol>
      <CopyValue
        label="Exemplo de criação"
        value={
          "harness new agent my-agent\ncd my-agent\nharness generate package --target claude-code\nharness validate package\nharness pack package -o ../my-agent-1.0.0.tar.gz"
        }
      />
      <p>
        O esqueleto inclui o workflow de release. Use uma tag como{" "}
        <code>v1.0.0</code>, correspondente à versão do pacote Agent Plugins.
        Aguarde o arquivo <code>.tar.gz</code> aparecer na release antes de
        publicar aqui.
      </p>
      <p>
        O código e os arquivos continuam no GitHub. Tokens de serviços ficam na
        plataforma; não entram no repositório.
      </p>
    </details>
  );
}
