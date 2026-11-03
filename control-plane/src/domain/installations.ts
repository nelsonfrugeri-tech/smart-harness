// What a developer installed with the CLI: `harness` reports the whole set after each change,
// the front reads it to mark Marketplace packages as installed.

// Upper bound of plugins in one report, enforced by the route schema. It also bounds the
// unpaginated read: a user never has more rows than one report can carry.
export const MAX_REPORTED_PLUGINS = 200;
export const CLI_VERSION_MAX_LENGTH = 50;

export interface ReportedPlugin {
  name: string;
  version: string;
}

export interface InstallationReport {
  cliVersion: string;
  plugins: ReportedPlugin[];
}

export interface InstalledPlugin extends ReportedPlugin {
  installedAt: string;
}

// cliVersion and reportedAt are null, and plugins empty, before the first report.
export interface Installations {
  cliVersion: string | null;
  reportedAt: string | null;
  plugins: InstalledPlugin[];
}
