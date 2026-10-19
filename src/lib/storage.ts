// SOT: object-storage, minio-client, cdn-origin, cache-control, presigned-urls
// WHAT:  MinIO-backed object storage that fronts all media, acting as the CDN origin.
// WHY:   local disk cannot serve a screen fleet; media has to be pulled from an edge
//        near the store, not through the API node.
// HOW:   one bucket holds originals and derived renditions under a stable key layout,
//        and every object carries its own Cache-Control so the CDN caches segments
//        for a year and revalidates playlists in seconds. When MinIO is unreachable
//        the service degrades to local disk so a single box still runs.
// WHERE: consumed by src/lib/transcode.ts, src/lib/queue.ts and src/routes/content.ts

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { Client } from 'minio';
import { ROOT } from './paths.js';

const ENDPOINT = process.env.MINIO_ENDPOINT || 'localhost';
const PORT = Number(process.env.MINIO_PORT ?? 9000);
const USE_SSL = process.env.MINIO_USE_SSL === 'true';
const ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'brandcast';
const SECRET_KEY = process.env.MINIO_SECRET_KEY || 'brandcast-secret';
export const BUCKET = process.env.MINIO_BUCKET || 'brandcast-media';

/** Public base for TV clients. Point at a CDN in production; MinIO directly otherwise. */
export const CDN_BASE = (process.env.CDN_BASE_URL || '').replace(/\/$/, '');

// A CDN caches what the origin tells it to. A playlist changes when a rendition is
// rebuilt, so it revalidates every few seconds; segments and image variants are
// addressed by a key that never changes, so they are cached for a year. Without this
// the edge falls back to its own default and either serves a stale ladder or refetches
// every segment from MinIO — which is the thing the CDN was added to stop.
const PLAYLIST_MAX_AGE = Number(process.env.CDN_PLAYLIST_MAX_AGE ?? 10);
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

export const cacheControlFor = (key: string): string =>
  key.endsWith('.m3u8') ? `public, max-age=${PLAYLIST_MAX_AGE}` : IMMUTABLE_CACHE;

/** Headers stored on the object, so the edge and the browser see the same policy. */
const objectMeta = (key: string, contentType?: string): Record<string, string> => ({
  'Content-Type': contentType || 'application/octet-stream',
  'Cache-Control': cacheControlFor(key),
});

// Read on each use rather than at import: tests and the container entrypoint both set
// UPLOAD_DIR after this module is first loaded.
export const localDir = (): string => process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');

let client: Client | null = null;
let ready = false;

export function getClient(): Client {
  if (client) return client;
  client = new Client({
    endPoint: ENDPOINT, port: PORT, useSSL: USE_SSL,
    accessKey: ACCESS_KEY, secretKey: SECRET_KEY,
    // Hosted S3-compatible stores sign for a named region; without one the client would
    // probe for it and sign for us-east-1.
    ...(process.env.MINIO_REGION ? { region: process.env.MINIO_REGION } : {}),
  });
  return client;
}

/** Anonymous read on the bucket: the CDN and the TVs fetch without credentials. */
const PUBLIC_READ_POLICY = (bucket: string): string => JSON.stringify({
  Version: '2012-10-17',
  Statement: [{
    Effect: 'Allow',
    Principal: { AWS: ['*'] },
    Action: ['s3:GetObject'],
    Resource: [`arn:aws:s3:::${bucket}/*`],
  }],
});

export type StorageInfo = {
  driver: 'minio' | 'local';
  bucket?: string;
  endpoint?: string;
  error?: string;
};

/** Idempotent: creates the bucket and applies the read policy once. */
export async function initStorage(): Promise<StorageInfo> {
  if (process.env.STORAGE_DRIVER === 'local') { ready = false; return { driver: 'local' }; }
  try {
    const c = getClient();
    const exists = await c.bucketExists(BUCKET).catch(() => false);
    if (!exists) await c.makeBucket(BUCKET, process.env.MINIO_REGION || 'us-east-1');
    // Not every S3-compatible store implements bucket policies (Neon storage does not).
    // The bucket then stays private and media is served through the API's /media route.
    await c.setBucketPolicy(BUCKET, PUBLIC_READ_POLICY(BUCKET)).catch((err: Error) =>
      console.warn(`[storage] bucket policy not applied (${err.message}); serving via /media`));
    ready = true;
    return { driver: 'minio', bucket: BUCKET, endpoint: `${ENDPOINT}:${PORT}` };
  } catch (err) {
    console.warn(`[storage] MinIO unavailable (${(err as Error).message}); falling back to local disk`);
    ready = false;
    return { driver: 'local', error: (err as Error).message };
  }
}

export const storageReady = (): boolean => ready;
export const driver = (): 'minio' | 'local' => (ready ? 'minio' : 'local');

/**
 * Public URL for an object key.
 * CDN_BASE wins, so in production a screen fetches from the edge and never touches
 * the origin.
 */
export function publicUrl(key: string): string {
  if (!ready) return `/uploads/${key}`;
  if (CDN_BASE) return `${CDN_BASE}/${key}`;
  return `/media/${key}`;
}

/** Upload a local file and return its public URL. */
export async function putFile(key: string, filePath: string, contentType?: string): Promise<string> {
  if (!ready) {
    // Keep the full key path: HLS playlists reference siblings relatively, so
    // flattening to a basename would break v0/playlist.m3u8 -> segment000.ts.
    const dest = path.join(localDir(), key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (path.resolve(filePath) !== path.resolve(dest)) fs.copyFileSync(filePath, dest);
    return publicUrl(key);
  }
  await getClient().fPutObject(BUCKET, key, filePath, objectMeta(key, contentType));
  return publicUrl(key);
}

export async function putBuffer(key: string, buffer: Buffer, contentType?: string): Promise<string> {
  if (!ready) {
    const dest = path.join(localDir(), key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buffer);
    return publicUrl(key);
  }
  await getClient().putObject(BUCKET, key, buffer, buffer.length, objectMeta(key, contentType));
  return publicUrl(key);
}

const CONTENT_TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export const contentTypeFor = (key: string): string =>
  CONTENT_TYPES[path.extname(key).toLowerCase()] ?? 'application/octet-stream';

/** Recursively upload a directory (used for the HLS ladder). */
export async function putDirectory(prefix: string, dir: string): Promise<string[]> {
  const uploaded: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      uploaded.push(...(await putDirectory(`${prefix}/${entry.name}`, full)));
    } else {
      const key = `${prefix}/${entry.name}`;
      await putFile(key, full, contentTypeFor(key));
      uploaded.push(key);
    }
  }
  return uploaded;
}

export async function getStream(key: string): Promise<Readable> {
  if (!ready) return fs.createReadStream(path.join(localDir(), key));
  return getClient().getObject(BUCKET, key);
}

/**
 * Pull an object down to a local file. A transcode worker on another node has the
 * job row but not the uploader's temp file, so the object store is the shared source.
 */
export async function downloadTo(key: string, destPath?: string): Promise<string> {
  const dest = destPath
    ?? path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bc-src-')), path.basename(key));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const stream = await getStream(key);
  await pipeline(stream, fs.createWriteStream(dest));
  return dest;
}

export type ObjectStat = { size: number; lastModified?: Date };

export async function statObject(key: string): Promise<ObjectStat> {
  if (!ready) {
    const s = fs.statSync(path.join(localDir(), key));
    return { size: s.size, lastModified: s.mtime };
  }
  const s = await getClient().statObject(BUCKET, key);
  return { size: s.size, lastModified: s.lastModified };
}

export async function removePrefix(prefix: string): Promise<void> {
  if (!ready) { fs.rmSync(path.join(localDir(), prefix), { recursive: true, force: true }); return; }
  const c = getClient();
  const keys: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const stream = c.listObjectsV2(BUCKET, prefix, true);
    stream.on('data', (o) => { if (o.name) keys.push(o.name); });
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
  if (keys.length) await c.removeObjects(BUCKET, keys);
}

/** Time-limited URL for assets that are not public (the untranscoded original). */
export async function presign(key: string, expirySeconds = 3600): Promise<string> {
  if (!ready) return publicUrl(key);
  return getClient().presignedGetObject(BUCKET, key, expirySeconds);
}

/** Stable key layout, so every rendition lives beside its original. */
export const keys = {
  original: (orgId: string, mediaId: string, ext: string) =>
    `org/${orgId}/media/${mediaId}/original${ext}`,
  posterFrame: (orgId: string, mediaId: string) =>
    `org/${orgId}/media/${mediaId}/poster.jpg`,
  imageVariant: (orgId: string, mediaId: string, width: number, format: string) =>
    `org/${orgId}/media/${mediaId}/img/${width}.${format}`,
  hlsRoot: (orgId: string, mediaId: string) => `org/${orgId}/media/${mediaId}/hls`,
  hlsMaster: (orgId: string, mediaId: string) => `org/${orgId}/media/${mediaId}/hls/master.m3u8`,
  mp4Variant: (orgId: string, mediaId: string, height: number) =>
    `org/${orgId}/media/${mediaId}/mp4/${height}p.mp4`,
};
