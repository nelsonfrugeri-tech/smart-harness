import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../src/db/database.ts";
import { findUserByEmail, listMembershipsOfUser } from "../../src/db/repos/identity.ts";
import { createPackageStorage, type PackageStorage } from "../../src/storage/packages.ts";
import { FakeS3, seededDatabase, TEST_BUCKET, tenantId } from "../test-support.ts";
import { buildPrincipal, type Principal } from "../../src/domain/access.ts";
import { PublishError, type PreparedPackage } from "../../src/domain/marketplace.ts";
import { persistVersion, prepareVersion, type HarnessClient } from "../../src/domain/publish.ts";

function principal(db: Db, email: string): Principal {
  const user = findUserByEmail(db, email);
  if (!user) throw new Error(`no user ${email}`);
  return buildPrincipal(user, listMembershipsOfUser(db, user.id));
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function prepared(name: string, version: string, archive: Uint8Array = randomBytes(512)): PreparedPackage {
  return {
    manifest: {
      name,
      version,
      description: `${name} test package`,
      components: [{ kind: "skill", name: `${name}-skill`, description: "" }],
    },
    archive,
    digest: sha256(archive),
  };
}

async function publishError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PublishError) return error.code;
    throw error;
  }
  throw new Error("expected a PublishError");
}

describe("persistVersion", () => {
  let db: Db;
  let s3: FakeS3;
  let storage: PackageStorage;
  let admin: Principal;

  beforeEach(() => {
    db = seededDatabase();
    s3 = new FakeS3([TEST_BUCKET]);
    storage = createPackageStorage(s3, TEST_BUCKET);
    admin = principal(db, "admin@smart-harness.local");
  });

  afterEach(() => db.close());

  const versionCount = () => (db.prepare("SELECT count(*) AS n FROM plugin_versions").get() as { n: number }).n;

  it("stores the archive under its digest and records the version", async () => {
    const pkg = prepared("demo", "1.0.0");

    const result = await persistVersion({ db, storage }, admin, { tenantId: tenantId(db, "conta"), visibility: "squad" }, pkg);

    expect(result).toEqual({ status: "created", storedArchive: true });
    expect(s3.keys(TEST_BUCKET)).toEqual([`packages/sha256-${pkg.digest.slice(7)}.tar.gz`]);
    expect(db.prepare("SELECT version, visibility, digest, size_bytes AS size FROM plugin_versions").all()).toEqual([
      { version: "1.0.0", visibility: "squad", digest: pkg.digest, size: 512 },
    ]);
  });

  it("keeps only the digest in the database, never the package bytes", async () => {
    const pkg = prepared("demo", "1.0.0", randomBytes(4096));
    await persistVersion({ db, storage }, admin, { tenantId: tenantId(db, "conta"), visibility: "squad" }, pkg);

    const file = db.serialize();
    expect(file.includes(Buffer.from(pkg.archive.subarray(0, 64)))).toBe(false);
    expect(file.includes(Buffer.from(pkg.digest))).toBe(true);
  });

  it("publishing the same content twice changes nothing and does not duplicate the object", async () => {
    const pkg = prepared("demo", "1.0.0");
    const target = { tenantId: tenantId(db, "conta"), visibility: "squad" as const };

    await persistVersion({ db, storage }, admin, target, pkg);
    const again = await persistVersion({ db, storage }, admin, target, pkg);

    expect(again).toEqual({ status: "unchanged", storedArchive: false });
    expect(s3.keys(TEST_BUCKET)).toHaveLength(1);
    expect(versionCount()).toBe(1);
  });

  it("a changed byte stops the publication before anything is written", async () => {
    const pkg = prepared("demo", "1.0.0");
    const tampered = { ...pkg, archive: Uint8Array.from(pkg.archive, (byte, i) => (i === 0 ? byte ^ 1 : byte)) };

    const code = await publishError(
      persistVersion({ db, storage }, admin, { tenantId: tenantId(db, "conta"), visibility: "squad" }, tampered),
    );

    expect(code).toBe("digest_mismatch");
    expect(s3.keys(TEST_BUCKET)).toEqual([]);
    expect(versionCount()).toBe(0);
  });

  it("an existing version with other content is refused: versions are immutable", async () => {
    const target = { tenantId: tenantId(db, "conta"), visibility: "squad" as const };
    await persistVersion({ db, storage }, admin, target, prepared("demo", "1.0.0"));

    const code = await publishError(persistVersion({ db, storage }, admin, target, prepared("demo", "1.0.0")));

    expect(code).toBe("version_exists");
    expect(versionCount()).toBe(1);
    expect(() => db.prepare("UPDATE plugin_versions SET visibility = 'organization'").run()).toThrow("immutable");
    expect(() => db.prepare("DELETE FROM plugin_versions").run()).toThrow("immutable");
  });

  it("when the database step fails, the uploaded archive is reused by the next publication", async () => {
    await persistVersion({ db, storage }, admin, { tenantId: tenantId(db, "conta"), visibility: "squad" }, prepared("demo", "1.0.0"));
    const pkg = prepared("demo", "2.0.0");

    // demo belongs to conta: the transaction refuses it after the upload.
    const code = await publishError(
      persistVersion({ db, storage }, admin, { tenantId: tenantId(db, "cartoes"), visibility: "squad" }, pkg),
    );
    const retry = await persistVersion({ db, storage }, admin, { tenantId: tenantId(db, "conta"), visibility: "squad" }, pkg);

    expect(code).toBe("plugin_owned_by_other_squad");
    expect(retry).toEqual({ status: "created", storedArchive: false });
    expect(s3.keys(TEST_BUCKET)).toHaveLength(2);
  });

  it("only an ADMIN of the owner squad publishes", async () => {
    const dev = principal(db, "dev@smart-harness.local");

    const asDev = await publishError(
      persistVersion({ db, storage }, dev, { tenantId: tenantId(db, "conta"), visibility: "squad" }, prepared("demo", "1.0.0")),
    );

    expect(asDev).toBe("forbidden");
    expect(s3.keys(TEST_BUCKET)).toEqual([]);
  });
});

describe("prepareVersion", () => {
  let sourceDir: string;

  beforeEach(() => {
    sourceDir = mkdtempSync(join(tmpdir(), "author-package-"));
    writeFileSync(
      join(sourceDir, "plugin.json"),
      JSON.stringify({ name: "demo", version: "0.1.0", description: "Demo package" }),
    );
    writeFileSync(join(sourceDir, "mcp.json"), JSON.stringify({ mcpServers: { docs: { type: "streamable-http" } } }));
    mkdirSync(join(sourceDir, "skills", "write-tests"), { recursive: true });
    writeFileSync(join(sourceDir, "skills", "write-tests", "SKILL.md"), "---\nname: write-tests\n---\n");
    mkdirSync(join(sourceDir, "dev.smartharness", "agents"), { recursive: true });
    writeFileSync(join(sourceDir, "dev.smartharness", "agents", "reviewer.agent.md"), "---\nname: reviewer\n---\n");
  });

  afterEach(() => rmSync(sourceDir, { recursive: true, force: true }));

  // Records the calls; generate writes a file into the directory it receives,
  // pack writes some bytes and prints their digest (or a wrong one).
  function fakeHarness(options: { valid?: boolean; wrongDigest?: boolean } = {}) {
    const calls: string[] = [];
    const client: HarnessClient = {
      async validate(dir) {
        calls.push(dir === sourceDir ? "validate source" : "validate copy");
        return options.valid === false
          ? { valid: false, findings: [{ code: "SH-AGT-001", message: "tools is missing" }] }
          : { valid: true, findings: [] };
      },
      async generate(dir, target) {
        calls.push(`generate ${target}`);
        mkdirSync(join(dir, ".claude-plugin"));
        writeFileSync(join(dir, ".claude-plugin", "plugin.json"), "{}");
      },
      async pack(dir, outFile) {
        calls.push("pack");
        const bytes = Buffer.from(readdirSync(dir).sort().join("\n"));
        await writeFile(outFile, bytes);
        return { digest: options.wrongDigest ? `sha256:${"0".repeat(64)}` : sha256(bytes) };
      },
    };
    return { client, calls };
  }

  it("validates, generates on a copy, packs and returns the archive with its manifest", async () => {
    const { client, calls } = fakeHarness();

    const result = await prepareVersion(client, sourceDir);

    expect(calls).toEqual(["validate copy", "generate claude-code", "pack"]);
    expect(result.digest).toBe(sha256(result.archive));
    expect(Buffer.from(result.archive).toString()).toContain(".claude-plugin");
    expect(result.manifest).toEqual({
      name: "demo",
      version: "0.1.0",
      description: "Demo package",
      components: [
        { kind: "agent", name: "reviewer", description: "" },
        { kind: "mcp", name: "docs", description: "" },
        { kind: "skill", name: "write-tests", description: "" },
      ],
    });
    expect(existsSync(join(sourceDir, ".claude-plugin"))).toBe(false);
  });

  it("stops after validate when the package is invalid and keeps the findings", async () => {
    const { client, calls } = fakeHarness({ valid: false });

    const error = await prepareVersion(client, sourceDir).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PublishError);
    expect(error).toMatchObject({ code: "invalid_package", details: [{ code: "SH-AGT-001" }] });
    expect(calls).toEqual(["validate copy"]);
  });

  it("packs the copy that was validated, not a source changed after validation", async () => {
    const { client } = fakeHarness();
    const packed: string[] = [];
    const harness: HarnessClient = {
      async validate(dir) {
        const report = await client.validate(dir);
        // The author edits the source right after the validator read it.
        writeFileSync(join(sourceDir, "skills", "write-tests", "SKILL.md"), "changed after validation");
        return report;
      },
      generate: client.generate,
      async pack(dir, outFile) {
        packed.push(readFileSync(join(dir, "skills", "write-tests", "SKILL.md"), "utf8"));
        return client.pack(dir, outFile);
      },
    };

    await prepareVersion(harness, sourceDir);

    expect(packed).toEqual(["---\nname: write-tests\n---\n"]);
  });

  it("refuses an archive whose hash differs from the digest printed by pack", async () => {
    const { client } = fakeHarness({ wrongDigest: true });

    expect(await publishError(prepareVersion(client, sourceDir))).toBe("digest_mismatch");
  });

  it("refuses a package whose plugin.json has an invalid version", async () => {
    writeFileSync(join(sourceDir, "plugin.json"), JSON.stringify({ name: "demo", version: "latest" }));
    const { client } = fakeHarness();

    expect(await publishError(prepareVersion(client, sourceDir))).toBe("invalid_package");
  });
});
