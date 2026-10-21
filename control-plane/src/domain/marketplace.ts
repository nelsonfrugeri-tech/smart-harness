// Marketplace vocabulary: plugins, their immutable versions and the components they ship.
import { createHash } from "node:crypto";

export type Visibility = "squad" | "organization";
export type PluginType = "connector" | "skill" | "agent";
export const PLUGIN_TYPES: readonly PluginType[] = ["connector", "skill", "agent"];

export type ComponentKind = "agent" | "skill" | "mcp";

export const VISIBILITIES: readonly Visibility[] = ["squad", "organization"];
export const COMPONENT_KINDS: readonly ComponentKind[] = ["agent", "skill", "mcp"];

// Same rules in the route parameters (JSON Schema) and in the publication.
export const PLUGIN_NAME_PATTERN = "^[a-z0-9][a-z0-9-]{0,63}$";
export const VERSION_PATTERN = "^[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?$";

export interface Component {
  kind: ComponentKind;
  name: string;
  description: string;
}

// What a package declares about itself; stored next to the digest.
export interface PackageManifest {
  name: string;
  version: string;
  description: string;
  keywords?: string[];
  components: Component[];
}

// A package ready to persist: the archive bytes and their digest ("sha256:<hex>").
export interface PreparedPackage {
  manifest: PackageManifest;
  archive: Uint8Array;
  digest: string;
}

export type PublishErrorCode =
  | "forbidden"
  | "invalid_package"
  | "digest_mismatch"
  | "plugin_owned_by_other_squad"
  | "version_exists";

// Expected publication failures; the caller (seed today, approval in #16) maps the code.
export class PublishError extends Error {
  readonly code: PublishErrorCode;
  readonly details: unknown;

  constructor(code: PublishErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "PublishError";
    this.code = code;
    this.details = details;
  }
}

const DIGEST =/^sha256:[0-9a-f]{64}$/;

// The digest of a package is the sha256 of its tar.gz bytes, so a download can be checked locally.
export function digestOf(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function isDigest(value: string): boolean {
  return DIGEST.test(value);
}

export function isPluginName(value: string): boolean {
  return new RegExp(PLUGIN_NAME_PATTERN).test(value);
}

export function isVersion(value: string): boolean {
  return new RegExp(VERSION_PATTERN).test(value);
}
