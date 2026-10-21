import { createHash, randomUUID } from "node:crypto";
import { DeleteBucketCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { FakeS3 } from "../test-support.ts";
import { createPackageStorage, createS3Client, packageKey } from "./packages.ts";

const BYTES = new TextEncoder().encode("package bytes");
const DIGEST = `sha256:${createHash("sha256").update(BYTES).digest("hex")}`;

describe("packageKey", () => {
  it("names the object after the digest", () => {
    expect(packageKey(DIGEST)).toBe(`packages/sha256-${DIGEST.slice(7)}.tar.gz`);
  });

  it("refuses anything that is not a sha256 digest", () => {
    for (const bad of ["sha256:abc", `md5:${"0".repeat(64)}`, `sha256:${"A".repeat(64)}`, "../../etc/passwd"]) {
      expect(() => packageKey(bad), bad).toThrow("invalid package digest");
    }
  });
});

describe("package storage", () => {
  it("stores the same content once: a second put is a no-op", async () => {
    const s3 = new FakeS3(["packages"]);
    const storage = createPackageStorage(s3, "packages");

    expect(await storage.putPackage(DIGEST, BYTES)).toEqual({ created: true });
    expect(await storage.putPackage(DIGEST, BYTES)).toEqual({ created: false });

    expect(s3.keys("packages")).toEqual([packageKey(DIGEST)]);
    expect(s3.sent.filter((name) => name === "PutObjectCommand")).toHaveLength(1);
  });

  it("refuses bytes that do not match the digest and stores nothing", async () => {
    const s3 = new FakeS3(["packages"]);
    const storage = createPackageStorage(s3, "packages");

    await expect(storage.putPackage(DIGEST, new TextEncoder().encode("other"))).rejects.toThrow("do not match");
    expect(s3.keys("packages")).toEqual([]);
  });

  it("returns the stored bytes, undefined for an unknown digest, and fails on a tampered object", async () => {
    const s3 = new FakeS3(["packages"]);
    const storage = createPackageStorage(s3, "packages");
    await storage.putPackage(DIGEST, BYTES);

    expect(await storage.getPackage(DIGEST)).toEqual(BYTES);
    expect(await storage.getPackage(`sha256:${"0".repeat(64)}`)).toBeUndefined();

    s3.objects.set(`packages/${packageKey(DIGEST)}`, new Uint8Array([0]));
    await expect(storage.getPackage(DIGEST)).rejects.toThrow("does not match");
  });

  it("ensureBucket creates a missing bucket and keeps an existing one", async () => {
    const s3 = new FakeS3();
    const storage = createPackageStorage(s3, "packages");

    await expect(storage.ping()).rejects.toThrow();
    await storage.ensureBucket();
    await storage.ensureBucket();

    await storage.ping();
    expect(s3.sent.filter((name) => name === "CreateBucketCommand")).toHaveLength(1);
  });
});

// Runs against a real MinIO/S3 only when TEST_S3_ENDPOINT is set, for example:
// TEST_S3_ENDPOINT=http://127.0.0.1:9000 TEST_S3_ACCESS_KEY_ID=... TEST_S3_SECRET_ACCESS_KEY=... npx vitest run src/storage
const endpoint = process.env.TEST_S3_ENDPOINT;
describe.skipIf(endpoint === undefined)("package storage against a real S3 endpoint", () => {
  it("creates the bucket, stores once and reads back the same bytes", async () => {
    const bucket = `test-${randomUUID()}`;
    const client = createS3Client({
      endpoint,
      region: "us-east-1",
      bucket,
      accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY,
    });
    const storage = createPackageStorage(client, bucket);
    const bytes = new TextEncoder().encode(`real s3 ${bucket}`);
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

    // The test owns this bucket and its single object, and removes both at the end.
    try {
      await storage.ensureBucket();
      expect(await storage.putPackage(digest, bytes)).toEqual({ created: true });
      expect(await storage.putPackage(digest, bytes)).toEqual({ created: false });
      expect(await storage.getPackage(digest)).toEqual(bytes);
      expect(await storage.getPackage(`sha256:${"0".repeat(64)}`)).toBeUndefined();
    } finally {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: packageKey(digest) })).catch(() => undefined);
      await client.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => undefined);
      client.destroy();
    }
  });
});
