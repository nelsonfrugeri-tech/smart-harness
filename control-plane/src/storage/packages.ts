// Package archives in S3-compatible object storage (MinIO locally, S3 in production).
// The object key is derived from the digest, so an archive is immutable and stored once.
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { digestOf, isDigest } from "../domain/marketplace.ts";

export interface StorageConfig {
  // Unset in production S3; set to the MinIO URL locally.
  endpoint?: string;
  region: string;
  bucket: string;
  // Both or neither; without them the SDK uses its default credential chain.
  accessKeyId?: string;
  secretAccessKey?: string;
}

export interface PackageStorage {
  // Stores the archive under its digest. created is false when the object already existed.
  putPackage(digest: string, bytes: Uint8Array): Promise<{ created: boolean }>;
  // Returns undefined when no archive has this digest.
  getPackage(digest: string): Promise<Uint8Array | undefined>;
  // Creates the bucket when it does not exist yet (API startup).
  ensureBucket(): Promise<void>;
  // Readiness probe: throws when the bucket is not reachable.
  ping(): Promise<void>;
}

// The only S3Client method the storage uses; tests pass an in-memory implementation.
export type S3Sender = Pick<S3Client, "send">;

// One attempt per call and explicit timeouts: Phase 1 has no retry policy.
// Without throwOnRequestTimeout the SDK only logs a warning and the call keeps waiting.
const CONNECTION_TIMEOUT_MS = 2_000;
const REQUEST_TIMEOUT_MS = 30_000;

// requestTimeoutMs is a parameter only so tests can use a short value.
export function createS3Client(config: StorageConfig, requestTimeoutMs = REQUEST_TIMEOUT_MS): S3Client {
  return new S3Client({
    region: config.region,
    ...(config.endpoint === undefined ? {} : { endpoint: config.endpoint, forcePathStyle: true }),
    ...(config.accessKeyId === undefined || config.secretAccessKey === undefined
      ? {}
      : { credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }),
    maxAttempts: 1,
    requestHandler: {
      connectionTimeout: CONNECTION_TIMEOUT_MS,
      requestTimeout: requestTimeoutMs,
      throwOnRequestTimeout: true,
    },
  });
}

// packages/sha256-<hex>.tar.gz: the name is the content hash.
export function packageKey(digest: string): string {
  if (!isDigest(digest)) {
    throw new Error(`invalid package digest "${digest}"`);
  }
  return `packages/sha256-${digest.slice("sha256:".length)}.tar.gz`;
}

export function createPackageStorage(client: S3Sender, bucket: string): PackageStorage {
  return {
    async putPackage(digest, bytes) {
      if (digestOf(bytes) !== digest) {
        throw new Error(`package bytes do not match digest ${digest}`);
      }
      const key = packageKey(digest);
      if (await objectExists(client, bucket, key)) {
        return { created: false };
      }
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: "application/gzip" }),
      );
      return { created: true };
    },

    async getPackage(digest) {
      let response;
      try {
        response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: packageKey(digest) }));
      } catch (error) {
        if (isNotFound(error)) return undefined;
        throw error;
      }
      const bytes = await response.Body?.transformToByteArray();
      // The key is the hash: a mismatch means the stored object was altered.
      if (bytes === undefined || digestOf(bytes) !== digest) {
        throw new Error(`stored package does not match digest ${digest}`);
      }
      return bytes;
    },

    async ensureBucket() {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
        return;
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      try {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch (error) {
        // Another API instance created it between the two calls.
        if ((error as { name?: string }).name !== "BucketAlreadyOwnedByYou") throw error;
      }
    },

    async ping() {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    },
  };
}

async function objectExists(client: S3Sender, bucket: string, key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    candidate?.name === "NotFound" ||
    candidate?.name === "NoSuchKey" ||
    candidate?.name === "NoSuchBucket" ||
    candidate?.$metadata?.httpStatusCode === 404
  );
}
