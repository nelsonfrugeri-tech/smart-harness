import type { Db } from "../database.ts";
import { scopeTenantIdsJson, type Scope } from "../../domain/access.ts";
import type { InstallationReport, Installations, InstalledPlugin } from "../../domain/installations.ts";
import { VISIBLE } from "./marketplace.ts";

// Installations belong to a user, not to a tenant: the read filters by the owner's user id,
// like repos/gateway-tokens.ts. The write resolves plugin names through the Marketplace
// visibility rule, so a report never references a plugin the caller cannot see.

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

// Replaces the caller's whole set in one transaction: the header takes the new CLI version and
// report time; a plugin already present keeps installed_at and takes the reported version; a
// plugin absent from the report is deleted. Names outside the caller's visible catalog are
// dropped and returned in `ignored`. When a name repeats, the last version wins.
export function replaceInstallations(db: Db, scope: Scope, report: InstallationReport): { ignored: string[] } {
  return db
    .transaction(() => {
      const pluginIds = visiblePluginIds(db, scope, report.plugins.map((plugin) => plugin.name));
      db.prepare(
        `INSERT INTO user_installation_reports (user_id, cli_version) VALUES (?, ?)
         ON CONFLICT (user_id) DO UPDATE SET cli_version = excluded.cli_version, reported_at = ${NOW}`,
      ).run(scope.userId, report.cliVersion);

      const upsert = db.prepare(
        `INSERT INTO user_installations (user_id, plugin_id, version) VALUES (?, ?, ?)
         ON CONFLICT (user_id, plugin_id) DO UPDATE SET version = excluded.version`,
      );
      const ignored: string[] = [];
      const kept = new Set<string>();
      for (const plugin of report.plugins) {
        const pluginId = pluginIds.get(plugin.name);
        if (pluginId === undefined) {
          ignored.push(plugin.name);
          continue;
        }
        upsert.run(scope.userId, pluginId, plugin.version);
        kept.add(pluginId);
      }
      db.prepare(
        `DELETE FROM user_installations
          WHERE user_id = ? AND plugin_id NOT IN (SELECT value FROM json_each(?))`,
      ).run(scope.userId, JSON.stringify([...kept]));
      return { ignored };
    })
    .immediate();
}

// The caller's last report and its plugins ordered by name. One query each; the list is bounded
// by MAX_REPORTED_PLUGINS, so it is not paginated.
export function listInstallations(db: Db, userId: string): Installations {
  const report = db
    .prepare("SELECT cli_version AS cliVersion, reported_at AS reportedAt FROM user_installation_reports WHERE user_id = ?")
    .get(userId) as { cliVersion: string; reportedAt: string } | undefined;
  const plugins = db
    .prepare(
      `SELECT p.name, i.version, i.installed_at AS installedAt
         FROM user_installations i
         JOIN plugins p ON p.id = i.plugin_id
        WHERE i.user_id = ?
        ORDER BY p.name`,
    )
    .all(userId) as InstalledPlugin[];
  return { cliVersion: report?.cliVersion ?? null, reportedAt: report?.reportedAt ?? null, plugins };
}

// Plugin ids by name, limited to plugins with at least one version visible to the scope.
function visiblePluginIds(db: Db, scope: Scope, names: string[]): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT DISTINCT p.id, p.name
         FROM plugins p
         JOIN plugin_versions v ON v.plugin_id = p.id
        WHERE p.name IN (SELECT value FROM json_each(@names)) AND ${VISIBLE}`,
    )
    .all({ names: JSON.stringify(names), scope: scopeTenantIdsJson(scope) }) as { id: string; name: string }[];
  return new Map(rows.map((row) => [row.name, row.id]));
}
