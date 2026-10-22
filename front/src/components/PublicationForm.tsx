import {
  useState,
  type FormEvent,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Me, RepositoryRegistration } from "../api/client";
import type { useRepositoryPublication } from "../app/useRepositoryPublication";
import { Button } from "./Primitives";
import { Loading } from "./RequestState";
import { PublicationError, PublicationSuccess } from "./PublicationFeedback";
type Publication = ReturnType<typeof useRepositoryPublication>;
type Admins = Me["memberships"];
function parseRepository(raw: string): { owner: string; repo: string } | null {
  const value = raw.trim();
  let path = value;
  if (value.startsWith("https://")) {
    try {
      const url = new URL(value);
      if (
        url.hostname !== "github.com" ||
        url.username ||
        url.password ||
        url.port ||
        url.search ||
        url.hash
      )
        return null;
      path = url.pathname.slice(1);
    } catch {
      return null;
    }
  }
  const match = /^([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)\/?$/.exec(path);
  if (!match || match[2] === "." || match[2] === "..") return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}
export function PublicationForm({
  publication,
  admins,
}: {
  publication: Publication;
  admins: Admins;
}) {
  const [repository, setRepository] = useState("");
  const [tenantId, setTenantId] = useState(admins[0]?.tenant.id ?? "");
  const [visibility, setVisibility] =
    useState<RepositoryRegistration["visibility"]>("squad");
  const [tag, setTag] = useState("");
  const [invalid, setInvalid] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (publication.busy) return;
    const parsed = parseRepository(repository);
    if (!publication.selected && !parsed) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    void publication.publish(
      tag.trim(),
      publication.selected
        ? undefined
        : {
            ...parsed!,
            tenant_id: tenantId,
            visibility,
          },
    );
  }
  return (
    <form
      className="publication-form"
      onSubmit={submit}
      aria-label="Publicar uma versão"
    >
      <fieldset disabled={publication.busy}>
        <label>
          Repositório cadastrado
          <select
            value={publication.selected}
            onChange={(event) => {
              publication.select(event.target.value);
              setInvalid(false);
            }}
          >
            <option value="">Cadastrar novo repositório</option>
            {publication.repositories.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.owner}/{item.repo} · {item.tenant.name}
              </option>
            ))}
          </select>
        </label>
        {publication.repositories.loading && (
          <Loading label="Carregando repositórios…" />
        )}
        {publication.repositories.error && (
          <div className="publication-list-error" role="alert">
            <p>Não foi possível carregar todos os repositórios.</p>
            <Button
              type="button"
              variant="secondary"
              onClick={publication.more}
            >
              Tentar carregar novamente
            </Button>
          </div>
        )}
        {publication.repositories.cursor && !publication.repositories.error && (
          <Button
            type="button"
            variant="ghost"
            onClick={publication.more}
            disabled={publication.repositories.loading}
          >
            Carregar mais repositórios
          </Button>
        )}
        <RepositoryFields
          publication={publication}
          admins={admins}
          repository={repository}
          setRepository={setRepository}
          invalid={invalid}
          setInvalid={setInvalid}
          tenantId={tenantId}
          setTenantId={setTenantId}
          visibility={visibility}
          setVisibility={setVisibility}
        />
        <label>
          Tag da release
          <input
            value={tag}
            onChange={(event) => setTag(event.target.value)}
            placeholder="v1.0.0"
            autoComplete="off"
            required
            maxLength={128}
            pattern=".*\S.*"
            aria-describedby="release-hint"
          />
        </label>
        <p className="publication-hint" id="release-hint">
          Use a tag de uma release já publicada no GitHub.
        </p>
        <Button
          type="submit"
          disabled={
            publication.repositories.loading ||
            !tag.trim() ||
            (!publication.selected && (!repository.trim() || !tenantId))
          }
        >
          {publication.busy
            ? "Publicando…"
            : publication.error
              ? "Tentar publicar novamente"
              : "Publicar versão"}
        </Button>
      </fieldset>
      {publication.busy && <Loading label="Validando e publicando a versão…" />}
      {publication.error && <PublicationError error={publication.error} />}
      {publication.result && <PublicationSuccess result={publication.result} />}
    </form>
  );
}
interface RepositoryFieldsProps {
  publication: Publication;
  admins: Admins;
  repository: string;
  setRepository: (value: string) => void;
  invalid: boolean;
  setInvalid: (value: boolean) => void;
  tenantId: string;
  setTenantId: (value: string) => void;
  visibility: RepositoryRegistration["visibility"];
  setVisibility: Dispatch<SetStateAction<RepositoryRegistration["visibility"]>>;
}
function RepositoryFields({
  publication,
  admins,
  repository,
  setRepository,
  invalid,
  setInvalid,
  tenantId,
  setTenantId,
  visibility,
  setVisibility,
}: RepositoryFieldsProps) {
  const selected = publication.repositories.items.find(
    (item) => item.id === publication.selected,
  );
  return (
    <>
      {!publication.selected ? (
        <>
          <label>
            URL do repositório
            <input
              value={repository}
              onChange={(event) => {
                setRepository(event.target.value);
                setInvalid(false);
              }}
              placeholder="https://github.com/sua-equipe/seu-pacote"
              autoComplete="off"
              required
              aria-invalid={invalid || undefined}
              aria-describedby="repository-hint"
            />
          </label>
          <p
            id="repository-hint"
            className={invalid ? "publication-validation" : "publication-hint"}
          >
            {invalid
              ? "Informe uma URL HTTPS do GitHub ou proprietário/repositório, sem credenciais ou parâmetros."
              : "Você também pode informar proprietário/repositório."}
          </p>
          <div className="publication-field-row">
            {admins.length > 1 ? (
              <label>
                Squad responsável
                <select
                  value={tenantId}
                  onChange={(event) => setTenantId(event.target.value)}
                  required
                >
                  {admins.map((membership) => (
                    <option
                      key={membership.tenant.id}
                      value={membership.tenant.id}
                    >
                      {membership.tenant.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="publication-squad">
                <span>Squad responsável</span>
                <strong>{admins[0]?.tenant.name}</strong>
              </div>
            )}
            <label>
              Quem pode instalar
              <select
                value={visibility}
                onChange={(event) =>
                  setVisibility(
                    event.target.value as RepositoryRegistration["visibility"],
                  )
                }
              >
                <option value="squad">Somente a squad</option>
                <option value="organization">Toda a organização</option>
              </select>
            </label>
          </div>
        </>
      ) : (
        selected && (
          <div className="publication-repository-context">
            <strong>
              {selected.owner}/{selected.repo}
            </strong>
            <p>
              {selected.tenant.name} ·{" "}
              {selected.visibility === "organization"
                ? "Toda a organização"
                : "Somente a squad"}
            </p>
            <p>
              {selected.last_sync
                ? `Última publicação: v${selected.last_sync.version}`
                : "Nenhuma versão publicada ainda."}
            </p>
          </div>
        )
      )}
    </>
  );
}
