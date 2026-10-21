// Sample Marketplace for local development: one baseline package per squad, a second version
// of investimentos-base, and code-review, owned by cartoes and shared with the organization.
//
// The archives in seed/packages/ are fixtures already generated and packed (reproducible tar.gz).
// Until the harness engine (#9) is on master, the seed skips prepareVersion: it hashes each
// fixture in Node and calls persistVersion, the same second step the approval flow uses.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Db } from "../src/db/database.ts";
import { findUserByEmail, listMembershipsOfUser } from "../src/db/repos/identity.ts";
import { pinBaselineVersion } from "../src/db/repos/marketplace.ts";
import { tenantIdBySlug } from "../src/db/repos/seed.ts";
import { buildPrincipal } from "../src/domain/access.ts";
import { digestOf, type PackageManifest, type Visibility } from "../src/domain/marketplace.ts";
import { persistVersion } from "../src/domain/publish.ts";
import type { PackageStorage } from "../src/storage/packages.ts";
import type { TenantSlug } from "./local-data.ts";

export const PACKAGES_DIR = fileURLToPath(new URL("./packages/", import.meta.url));

// The seed publishes as the local ADMIN, who belongs to every squad.
const PUBLISHER_EMAIL = "admin@smart-harness.local";

export interface Fixture {
  file: string;
  tenant: TenantSlug;
  visibility: Visibility;
  manifest: PackageManifest;
}

const INVESTIMENTOS_ASSISTANT = {
  kind: "agent",
  name: "investimentos-assistant",
  description: "Answers questions about the investment orders and portfolio API.",
} as const;
const INVESTIMENTOS_CONVENTIONS = {
  kind: "skill",
  name: "investimentos-conventions",
  description: "Coding and review conventions of the Investimentos API.",
} as const;
const GITHUB = { kind: "mcp", name: "github", description: "GitHub through the Agent Gateway." } as const;

// Listed in publication order: the last version of a plugin is its latest.
export const FIXTURES: Fixture[] = [
  {
    file: "investimentos-base-1.0.0.tar.gz",
    tenant: "investimentos",
    visibility: "squad",
    manifest: {
      name: "investimentos-base",
      version: "1.0.0",
      description: "Baseline package of the Investimentos squad.",
      components: [INVESTIMENTOS_ASSISTANT, GITHUB, INVESTIMENTOS_CONVENTIONS],
    },
  },
  {
    file: "investimentos-base-1.1.0.tar.gz",
    tenant: "investimentos",
    visibility: "squad",
    manifest: {
      name: "investimentos-base",
      version: "1.1.0",
      description: "Baseline package of the Investimentos squad.",
      components: [
        INVESTIMENTOS_ASSISTANT,
        GITHUB,
        INVESTIMENTOS_CONVENTIONS,
        { kind: "skill", name: "order-review", description: "Checklist to review changes in the order flow." },
      ],
    },
  },
  {
    file: "conta-base-1.0.0.tar.gz",
    tenant: "conta",
    visibility: "squad",
    manifest: {
      name: "conta-base",
      version: "1.0.0",
      description: "Baseline package of the Conta squad.",
      components: [
        { kind: "agent", name: "conta-assistant", description: "Answers questions about the digital account backend." },
        GITHUB,
        { kind: "skill", name: "conta-conventions", description: "Coding and review conventions of the Conta Digital backend." },
      ],
    },
  },
  {
    file: "cartoes-base-1.0.0.tar.gz",
    tenant: "cartoes",
    visibility: "squad",
    manifest: {
      name: "cartoes-base",
      version: "1.0.0",
      description: "Baseline package of the Cartoes squad.",
      components: [
        { kind: "agent", name: "cartoes-assistant", description: "Answers questions about the card management app." },
        { kind: "skill", name: "cartoes-conventions", description: "Coding and review conventions of the Cartoes app." },
      ],
    },
  },
  {
    file: "code-review-1.0.0.tar.gz",
    tenant: "cartoes",
    visibility: "organization",
    manifest: {
      name: "code-review",
      version: "1.0.0",
      description: "Code review skill shared with the whole organization.",
      components: [
        {
          kind: "skill",
          name: "code-review",
          description: "Reviews a diff for correctness, tests and security before a pull request.",
        },
      ],
    },
  },
];

export const BASELINE: { project: string; plugin: string; version: string }[] = [
  { project: "investimentos-api", plugin: "investimentos-base", version: "1.1.0" },
  { project: "conta-digital", plugin: "conta-base", version: "1.0.0" },
  { project: "cartoes-app", plugin: "cartoes-base", version: "1.0.0" },
  { project: "cartoes-app", plugin: "code-review", version: "1.0.0" },
];

export interface MarketplaceSeedResult {
  created: number;
  unchanged: number;
  storedArchives: number;
  baseline: number;
}

// Idempotent: publishing the same archive again changes nothing, in the database or the bucket.
export async function seedMarketplace(deps: { db: Db; storage: PackageStorage }): Promise<MarketplaceSeedResult> {
  const user = findUserByEmail(deps.db, PUBLISHER_EMAIL);
  if (!user) {
    throw new Error(`${PUBLISHER_EMAIL} not found; run npm run seed first`);
  }
  const publisher = buildPrincipal(user, listMembershipsOfUser(deps.db, user.id));
  const result: MarketplaceSeedResult = { created: 0, unchanged: 0, storedArchives: 0, baseline: 0 };

  for (const fixture of FIXTURES) {
    const archive = await readFile(`${PACKAGES_DIR}${fixture.file}`);
    const tenantId = tenantIdBySlug(deps.db, fixture.tenant);
    const { status, storedArchive } = await persistVersion(
      deps,
      publisher,
      { tenantId, visibility: fixture.visibility },
      { manifest: fixture.manifest, archive, digest: digestOf(archive) },
    );
    result[status] += 1;
    if (storedArchive) result.storedArchives += 1;
  }

  for (const pin of BASELINE) {
    if (!pinBaselineVersion(deps.db, publisher.scope, { projectSlug: pin.project, pluginName: pin.plugin, version: pin.version })) {
      throw new Error(`cannot pin ${pin.plugin}@${pin.version} in ${pin.project}`);
    }
    result.baseline += 1;
  }
  return result;
}
