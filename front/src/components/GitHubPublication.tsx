import { useEffect, useRef } from "react";
import { Github, X } from "lucide-react";
import type { Me } from "../api/client";
import { useRepositoryPublication } from "../app/useRepositoryPublication";
import { Button } from "./Primitives";
import { PublicationGuide } from "./PublicationGuide";
import { PublicationForm } from "./PublicationForm";
interface Props {
  token: string;
  expire: () => void;
  memberships: Me["memberships"];
  published: () => void;
  close: () => void;
}
export function GitHubPublication({
  token,
  expire,
  memberships,
  published,
  close,
}: Props) {
  const title = useRef<HTMLHeadingElement>(null);
  const admins = memberships.filter(
    (membership) => membership.role === "ADMIN",
  );
  const publication = useRepositoryPublication(token, expire, published);
  useEffect(() => {
    title.current?.focus();
  }, []);
  return (
    <section
      className="panel github-publication"
      aria-labelledby="publication-title"
      id="github-publication"
    >
      <header className="publication-heading">
        <span className="publication-icon">
          <Github size={24} aria-hidden="true" />
        </span>
        <div>
          <span className="eyebrow">DO REPOSITÓRIO AO MARKETPLACE</span>
          <h2 id="publication-title" ref={title} tabIndex={-1}>
            Publicar do GitHub
          </h2>
          <p>
            Escolha um repositório e a versão que deseja disponibilizar para sua
            equipe.
          </p>
        </div>
        <Button variant="ghost" onClick={close} aria-label="Fechar publicação">
          <X size={18} aria-hidden="true" />
        </Button>
      </header>
      <div className="publication-layout">
        <PublicationForm publication={publication} admins={admins} />

        <aside
          className="publication-explainer"
          aria-label="Como funciona a publicação"
        >
          <ol>
            <li>
              <span>1</span>
              <div>
                <strong>Crie e revise no GitHub</strong>
                <p>
                  Seu repositório guarda o pacote e o histórico de mudanças.
                </p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Escolha uma release</strong>
                <p>
                  O Harness valida o pacote antes de disponibilizar essa versão.
                </p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Compartilhe com a equipe</strong>
                <p>
                  Tools, Skills e Agents ficam prontos para instalar pelo CLI.
                </p>
              </div>
            </li>
          </ol>
          <PublicationGuide />
        </aside>
      </div>
    </section>
  );
}
