import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SignJWT, jwtVerify } from 'jose';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
} from '@aws-sdk/client-s3';

const ISSUER = 'plos-api-export-downloads';
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // docs/07-privacy-model.md §5: 7-day presigned download window

/**
 * ADR D6 (docs/02) specifies S3 for object storage. Milestone 8 is the
 * first time a real AWS account/bucket exists, so this now has two real
 * backends behind one contract (put a versioned blob, read a specific
 * version, delete every version) — `PLOS_OBJECT_STORE_DRIVER=s3` (set in
 * infra/ecs.tf's task definitions) switches to the real
 * `@aws-sdk/client-s3` client; anything else (local dev, the test suite,
 * neither of which has a real bucket) keeps using the local-filesystem
 * implementation this file always had. Callers (`ExportBundleService`,
 * `AccountDeletionService`) and the `documents` table shape
 * (`s3_bucket`/`s3_key`/`s3_version_id`, exactly as ADR D6 defines them)
 * never needed to change — only this file's internals did, matching the
 * seam this class was already built around.
 *
 * The download flow deliberately stays app-mediated (mintDownloadToken's
 * own custom, short-lived JWT — verified by `ExportDownloadController`,
 * not S3's native presigned-URL mechanism) rather than switching to a
 * real S3 presigned URL: that would change the actual contract callers
 * rely on (a URL the client can use without ever presenting their own
 * bearer session), which is a real design decision for a human to make
 * later, not something to fold silently into an infra swap.
 */
export interface StoredObjectRef {
  bucket: string;
  key: string;
  versionId: string;
}

@Injectable()
export class ExportBundleStorageService {
  private readonly secret = new TextEncoder().encode(
    process.env.EXPORT_DOWNLOAD_SECRET ?? 'plos_export_download_dev_only_secret',
  );
  private readonly rootDir =
    process.env.PLOS_LOCAL_OBJECT_STORE_DIR ?? path.join(process.cwd(), '.local-object-store');
  private readonly useS3 = process.env.PLOS_OBJECT_STORE_DRIVER === 's3';
  // No explicit credentials/region: Fargate's task role supplies both via
  // the SDK's default credential chain — the same reason no access key
  // ever appears in this file or in Secrets Manager for this purpose.
  private readonly s3 = this.useS3 ? new S3Client({}) : null;

  async put(bucket: string, key: string, data: Buffer): Promise<StoredObjectRef> {
    if (this.s3) {
      const result = await this.s3.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ServerSideEncryption: 'aws:kms' }),
      );
      if (!result.VersionId) {
        // Only possible if the bucket's own S3 Versioning was never
        // enabled (infra/storage.tf turns it on) — fail loudly rather
        // than silently proceeding with an unversioned write that
        // deleteAllVersions could never fully clean up later.
        throw new Error(`S3 bucket "${bucket}" did not return a VersionId — is bucket versioning enabled?`);
      }
      return { bucket, key, versionId: result.VersionId };
    }
    const versionId = randomUUID();
    const dir = path.join(this.rootDir, bucket, key);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, versionId), data);
    return { bucket, key, versionId };
  }

  async read(ref: StoredObjectRef): Promise<Buffer> {
    if (this.s3) {
      const result = await this.s3.send(
        new GetObjectCommand({ Bucket: ref.bucket, Key: ref.key, VersionId: ref.versionId }),
      );
      return Buffer.from(await result.Body!.transformToByteArray());
    }
    return fs.readFile(path.join(this.rootDir, ref.bucket, ref.key, ref.versionId));
  }

  /** Every version, not just the current one — docs/07 §7 step 5 is
   * explicit that a plain "delete current version" call is not enough
   * under S3 versioning (it only writes a delete marker); the real S3
   * path lists every version of the key and deletes each by VersionId in
   * one batch, the local equivalent removes the whole per-key directory. */
  async deleteAllVersions(bucket: string, key: string): Promise<void> {
    if (this.s3) {
      const versions = await this.s3.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: key }));
      const toDelete = [
        ...(versions.Versions ?? []),
        ...(versions.DeleteMarkers ?? []),
      ].filter((v) => v.Key === key);
      if (toDelete.length === 0) return;
      // ponytail-audit, Milestone 8 follow-up: DeleteObjectsCommand handles
      // a single-element Objects array identically to DeleteObjectCommand —
      // no need for a separate branch/import for the count-of-1 case.
      await this.s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: toDelete.map((v) => ({ Key: key, VersionId: v.VersionId })) },
        }),
      );
      return;
    }
    await fs.rm(path.join(this.rootDir, bucket, key), { recursive: true, force: true });
  }

  /** The "presigned URL" — a signed, time-boxed token embedding exactly
   * which object it authorizes, verified by the download endpoint without
   * requiring the caller's own bearer session token (a real presigned
   * link is meant to be usable on its own, e.g. pasted into a browser). */
  async mintDownloadToken(
    userId: string,
    ref: StoredObjectRef,
    ttlSeconds: number = DEFAULT_TTL_SECONDS,
  ): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const token = await new SignJWT({ bucket: ref.bucket, key: ref.key, versionId: ref.versionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(this.secret);
    return { token, expiresAt };
  }

  async verifyDownloadToken(token: string): Promise<{ userId: string; ref: StoredObjectRef } | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, { issuer: ISSUER });
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.bucket !== 'string' ||
        typeof payload.key !== 'string' ||
        typeof payload.versionId !== 'string'
      ) {
        return null;
      }
      return {
        userId: payload.sub,
        ref: { bucket: payload.bucket, key: payload.key, versionId: payload.versionId },
      };
    } catch {
      return null;
    }
  }
}
