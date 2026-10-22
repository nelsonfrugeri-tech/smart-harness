import { ArrowRight, FolderOpen, Terminal } from "lucide-react";
import { PageHeading } from "../components/Primitives";
import { followLink } from "../components/Shell";
export function Workspace() {
  return (
    <div className="page personal-workspace">
      <PageHeading
        eyebrow="WORKSPACE"
        title="Seu espaço, suas próximas ideias."
        description="Um lugar para organizar o que você vai construir."
      />
      <section
        className="workspace-blank"
        aria-labelledby="empty-workspace-title"
      >
        <div className="workspace-blank-icon">
          <FolderOpen size={34} strokeWidth={1.5} aria-hidden="true" />
        </div>
        <span className="eyebrow">UM NOVO COMEÇO</span>
        <h2 id="empty-workspace-title">Seu workspace está vazio</h2>
        <p>
          Prepare sua CLI e escolha os recursos do Marketplace para começar a
          desenvolver no seu próprio repositório.
        </p>
        <a className="button button-primary" href="/cli" onClick={followLink}>
          <Terminal size={17} aria-hidden="true" /> Preparar CLI{" "}
          <ArrowRight size={16} aria-hidden="true" />
        </a>
        <a className="text-link" href="/marketplace" onClick={followLink}>
          Explorar o Marketplace
        </a>
      </section>
    </div>
  );
}
