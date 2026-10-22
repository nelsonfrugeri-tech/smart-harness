import { readFile } from "node:fs/promises";
import type { Db } from "../src/db/database.ts";
import { findUserByEmail, listMembershipsOfUser } from "../src/db/repos/identity.ts";
import { tenantIdBySlug } from "../src/db/repos/seed.ts";
import { buildPrincipal } from "../src/domain/access.ts";
import { digestOf } from "../src/domain/marketplace.ts";
import { persistVersion } from "../src/domain/publish.ts";
import type { PackageStorage } from "../src/storage/packages.ts";
import { PERSONAL_ADMIN, PERSONAL_TENANT } from "./personal-data.ts";
import { PERSONAL_FIXTURES } from "./personal-packages.ts";

export async function seedPersonalMarketplace(deps: { db: Db; storage: PackageStorage }) {
  const user = findUserByEmail(deps.db, PERSONAL_ADMIN);
  if (!user) throw new Error(`${PERSONAL_ADMIN} not found; run npm run seed first`);
  const publisher = buildPrincipal(user, listMembershipsOfUser(deps.db, user.id));
  const tenantId = tenantIdBySlug(deps.db, PERSONAL_TENANT);
  // The demo uses a fresh database. Never delete or move a previously published package.
  const owner = deps.db.prepare("SELECT tenant_id FROM plugins WHERE name = ?");
  for (const fixture of PERSONAL_FIXTURES) {
    const existing = owner.get(fixture.manifest.name) as { tenant_id: string } | undefined;
    if (existing && existing.tenant_id !== tenantId) {
      throw new Error(`Package ${fixture.manifest.name} belongs to another tenant; use a separate database for the personal demo.`);
    }
  }
  const result = { created: 0, unchanged: 0, storedArchives: 0 };
  for (const fixture of PERSONAL_FIXTURES) {
    const archive = await readFile(new URL(`./packages/${fixture.file}`, import.meta.url));
    const { status, storedArchive } = await persistVersion(deps, publisher,
      { tenantId, visibility: "organization" }, { manifest: fixture.manifest, archive, digest: digestOf(archive) });
    result[status] += 1;
    if (storedArchive) result.storedArchives += 1;
  }
  return result;
}
