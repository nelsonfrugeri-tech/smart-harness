import { ArrowUpRight, ShieldCheck, UserRound } from "lucide-react";
import type { Me } from "../api/client";
import { GatewayTokens } from "./GatewayTokens";
import { PageHeading } from "../components/Primitives";
import { followLink } from "../components/Shell";
export function Profile({
  me,
  token,
  expire,
}: {
  me: Me;
  token: string;
  expire: () => void;
}) {
  const jobTitle =
    "job_title" in me.user && typeof me.user.job_title === "string"
      ? me.user.job_title
      : null;
  return (
    <div className="page profile-page">
      <PageHeading
        eyebrow="SUA CONTA"
        title="Meu perfil"
        description="Sua identidade na plataforma e as credenciais para trabalhar no terminal."
      />
      <section className="panel profile-card" aria-labelledby="identity-title">
        <div className="profile-avatar">
          <UserRound size={30} aria-hidden="true" />
        </div>
        <div className="profile-identity">
          <h2 id="identity-title">{me.user.name}</h2>
          <dl className="profile-fields">
            <div>
              <dt>Email</dt>
              <dd>{me.user.email}</dd>
            </div>
            <div>
              <dt>Cargo</dt>
              <dd>{jobTitle || "Não informado"}</dd>
            </div>
          </dl>
        </div>
        <a className="text-link" href="/cli" onClick={followLink}>
          Preparar minha CLI <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      </section>
      <div className="profile-token-intro">
        <ShieldCheck size={18} aria-hidden="true" />
        <p>
          Crie uma credencial por dispositivo. Você pode revogar o acesso quando
          precisar.
        </p>
      </div>
      <div id="tokens">
        <GatewayTokens token={token} expire={expire} embedded />
      </div>
    </div>
  );
}
