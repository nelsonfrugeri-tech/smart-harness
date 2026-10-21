import type { PluginVersion } from "../api/client";
export function visibilityLabel(version: PluginVersion) {
  return version.visibility === "organization"
    ? "Organização"
    : "Somente a squad";
}
export function VersionMetadata({ version }: { version: PluginVersion }) {
  return (
    <dl className="version-metadata">
      <div>
        <dt>Visibilidade</dt>
        <dd>{visibilityLabel(version)}</dd>
      </div>
      <div>
        <dt>Arquivo</dt>
        <dd>{version.size_bytes.toLocaleString("pt-BR")} bytes · tar.gz</dd>
      </div>
      <div>
        <dt>Publicação</dt>
        <dd>
          <time dateTime={version.published_at}>
            {new Date(version.published_at).toLocaleDateString("pt-BR", {
              timeZone: "UTC",
            })}
          </time>
        </dd>
      </div>
      <div className="metadata-digest">
        <dt>SHA-256 publicado</dt>
        <dd>
          <code>{version.digest}</code>
        </dd>
      </div>
    </dl>
  );
}
