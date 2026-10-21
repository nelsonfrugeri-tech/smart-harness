// Publication in two steps:
//   1. prepareVersion (async): the harness binary validates the author's package, generates
//      the Claude Code layer and packs a tar.gz. Nothing is stored.
//   2. persistVersion: stores the archive in object storage under its digest, then records
//      the version in the database in one synchronous transaction.
// The approval flow (#16) only runs step 2, with the package prepared and reviewed before.
// If step 2 fails after the upload, the archive stays without a version and is reused
// when the same content is published again (same digest, same key).
import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db } from "../db/database.ts";
import { savePublishedVersion } from "../db/repos/marketplace.ts";
import type { PackageStorage } from "../storage/packages.ts";
import type { Principal } from "./access.ts";
import {
  digestOf,
  isDigest,
  isPluginName,
  isVersion,
  PublishError,
  type Component,
  type PackageManifest,
  type PreparedPackage,
  type Visibility,
} from "./marketplace.ts";

export interface ValidationFinding {
  code: string;
  message: string;
  severity?: string;
  path?: string;
}

export interface ValidationReport {
  valid: boolean;
  findings: ValidationFinding[];
}

// The `harness` commands the API depends on. The real client runs the binary (harness/cli-client.ts);
// tests use a fake.
export interface HarnessClient {
  validate(dir: string): Promise<ValidationReport>;
  // Writes the generated layer into dir.
  generate(dir: string, target: "claude-code"): Promise<void>;
  // Writes the tar.gz to outFile and returns the digest the binary printed.
  pack(dir: string, outFile: string): Promise<{ digest: string }>;
}

export async function prepareVersion(harness: HarnessClient, sourceDir: string): Promise<PreparedPackage> {
  const report = await harness.validate(sourceDir);
  if (!report.valid) {
    throw new PublishError("invalid_package", "package failed validation", report.findings);
  }

  // generate writes into the directory, so it runs on a copy and never touches the author's files.
  const workDir = await mkdtemp(join(tmpdir(), "harness-publish-"));
  try {
    const packageDir = join(workDir, "package");
    await cp(sourceDir, packageDir, { recursive: true });
    await harness.generate(packageDir, "claude-code");

    const archivePath = join(workDir, "package.tar.gz");
    const { digest } = await harness.pack(packageDir, archivePath);
    const archive = await readFile(archivePath);
    if (digestOf(archive) !== digest) {
      throw new PublishError(
        "digest_mismatch",
        `harness pack printed ${digest} but the archive hashes to ${digestOf(archive)}`,
      );
    }
    return { manifest: await readManifest(packageDir), archive, digest };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export interface PublishTarget {
  tenantId: string;
  visibility: Visibility;
}

export interface PersistResult {
  status: "created" | "unchanged";
  // false when the same archive was already in object storage.
  storedArchive: boolean;
}

// Only an ADMIN of the owner squad publishes. The archive must hash to the declared digest:
// a changed byte stops the publication before anything is written.
export async function persistVersion(
  deps: { db: Db; storage: PackageStorage },
  publisher: Principal,
  target: PublishTarget,
  prepared: PreparedPackage,
): Promise<PersistResult> {
  const isAdmin = publisher.memberships.some(
    (membership) => membership.tenant.id === target.tenantId && membership.role === "ADMIN",
  );
  if (!isAdmin) {
    throw new PublishError("forbidden", "only an ADMIN of the owner squad can publish");
  }
  checkManifest(prepared.manifest);
  if (!isDigest(prepared.digest) || digestOf(prepared.archive) !== prepared.digest) {
    throw new PublishError("digest_mismatch", `archive does not match digest ${prepared.digest}`);
  }

  const { created } = await deps.storage.putPackage(prepared.digest, prepared.archive);
  const { status } = savePublishedVersion(deps.db, publisher.scope, {
    tenantId: target.tenantId,
    visibility: target.visibility,
    manifest: prepared.manifest,
    digest: prepared.digest,
    sizeBytes: prepared.archive.byteLength,
  });
  return { status, storedArchive: created };
}

// Reads what the Marketplace lists from the package directory: plugin.json, the skill folders,
// the agent files and the MCP server names. Only file names and JSON, no other parsing.
export async function readManifest(dir: string): Promise<PackageManifest> {
  const plugin = (await readJson(join(dir, "plugin.json"))) as Partial<PackageManifest> | undefined;
  if (!plugin) {
    throw new PublishError("invalid_package", "plugin.json is missing");
  }

  const skills = (await listEntries(join(dir, "skills")))
    .filter((entry) => entry.isDirectory())
    .map((entry) => component("skill", entry.name));
  const agents = (await listEntries(join(dir, "dev.smartharness", "agents")))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".agent.md"))
    .map((entry) => component("agent", entry.name.slice(0, -".agent.md".length)));
  const mcp = (await readJson(join(dir, "mcp.json"))) as { mcpServers?: Record<string, unknown> } | undefined;
  const servers = Object.keys(mcp?.mcpServers ?? {}).map((name) => component("mcp", name));

  const manifest: PackageManifest = {
    name: String(plugin.name ?? ""),
    version: String(plugin.version ?? ""),
    description: String(plugin.description ?? ""),
    components: [...agents, ...skills, ...servers].sort((a, b) =>
      `${a.kind}/${a.name}`.localeCompare(`${b.kind}/${b.name}`),
    ),
  };
  checkManifest(manifest);
  return manifest;
}

function checkManifest(manifest: PackageManifest): void {
  if (!isPluginName(manifest.name)) {
    throw new PublishError("invalid_package", `plugin name "${manifest.name}" is invalid`);
  }
  if (!isVersion(manifest.version)) {
    throw new PublishError("invalid_package", `version "${manifest.version}" is not semantic (x.y.z)`);
  }
}

function component(kind: Component["kind"], name: string): Component {
  return { kind, name, description: "" };
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new PublishError("invalid_package", `${path} is not valid JSON`);
  }
}

async function listEntries(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
