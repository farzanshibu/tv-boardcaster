// SOT: object-storage, minio-client, cdn-origin, presigned-urls
// WHAT:  MinIO-backed object storage that fronts all media, acting as the CDN origin.
// WHY:   local disk cannot serve a screen fleet; the PRD calls for object storage +
//        CDN so TV clients pull media near their location, not through the API.
// HOW:   one bucket holds originals and derived renditions under a stable key layout.
//        When MinIO is unreachable the service degrades to local disk so the app still
//        runs for a single-box demo.
// WHERE: consumed by src/lib/transcode.js and src/routes/content.js

import { Client } from 'minio';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './db.js';

const ENDPOINT = process.env.MINIO_ENDPOINT || 'localhost';
const PORT = Number(process.env.MINIO_PORT || 9000);
const USE_SSL = process.env.MINIO_USE_SSL === 'true';
const ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'brandcast';
const SECRET_KEY = process.env.MINIO_SECRET_KEY || 'brandcast-secret';
export const BUCKET = process.env.MINIO_BUCKET || 'brandcast-media';

/** Public base for TV clients. Point at a CDN in production; MinIO directly otherwise. */
export const CDN_BASE = (process.env.CDN_BASE_URL || '').replace(/\/$/, '');

// Read on each use rather than at import: tests and the Docker entrypoint both
// set UPLOAD_DIR after this module is first loaded.
export const localDir = () => process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');

let client = null;
let ready = false;

export function getClient() {
  if (client) return client;
  client = new Client({
    endPoint: ENDPOINT, port: PORT, useSSL: USE_SSL,
    accessKey: ACCESS_KEY, secretKey: SECRET_KEY,
  });
  return client;
}

/** Anonymous read on the media prefix: the CDN and TVs fetch without credentials. */
const PUBLIC_READ_POLICY = (bucket) => JSON.stringify({
  Version: '2012-10-17',
  Statement: [{
    Effect: 'Allow',
    Principal: { AWS: ['*'] },
    Action: ['s3:GetObject'],
    Resource: [`arn:aws:s3:::${bucket}/*`],
  }],
});

/** Idempotent: creates the bucket and applies the read policy once. */
export async function initStorage() {
  if (process.env.STORAGE_DRIVER === 'local') { ready = false; return { driver: 'local' }; }
  try {
    const c = getClient();
    const exists = await c.bucketExists(BUCKET).catch(() => false);
    if (!exists) await c.makeBucket(BUCKET, process.env.MINIO_REGION || 'us-east-1');
    await c.setBucketPolicy(BUCKET, PUBLIC_READ_POLICY(BUCKET));
    ready = true;
    return { driver: 'minio', bucket: BUCKET, endpoint: `${ENDPOINT}:${PORT}` };
  } catch (err) {
    console.warn(`[storage] MinIO unavailable (${err.message}); falling back to local disk`);
    ready = false;
    return { driver: 'local', error: err.message };
  }
}

export const storageReady = () => ready;
export const driver = () => (ready ? 'minio' : 'local');

/**
 * Public URL for an object key.
 * CDN_BASE wins so a cache sits in front of MinIO in production.
 */
export function publicUrl(key) {
  if (!ready) return `/uploads/${key}`;
  if (CDN_BASE) return `${CDN_BASE}/${key}`;
  return `/media/${key}`;
}

/** Upload a local file and return its public URL. */
export async function putFile(key, filePath, contentType) {
  if (!ready) {
    // Keep the full key path: HLS playlists reference siblings relatively, so
    // flattening to a basename would break v0/playlist.m3u8 -> segment000.ts.
    const dest = path.join(localDir(), key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (path.resolve(filePath) !== path.resolve(dest)) fs.copyFileSync(filePath, dest);
    return publicUrl(key);
  }
  await getClient().fPutObject(BUCKET, key, filePath, { 'Content-Type': contentType });
  return publicUrl(key);
}

export async function putBuffer(key, buffer, contentType) {
  if (!ready) {
    const dest = path.join(localDir(), key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buffer);
    return publicUrl(key);
  }
  await getClient().putObject(BUCKET, key, buffer, buffer.length, { 'Content-Type': contentType });
  return publicUrl(key);
}

/** Recursively upload a directory (used for HLS renditions). */
export async function putDirectory(prefix, dir) {
  const uploaded = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      uploaded.push(...(await putDirectory(`${prefix}/${entry.name}`, full)));
    } else {
      const key = `${prefix}/${entry.name}`;
      const type = entry.name.endsWith('.m3u8')
        ? 'application/vnd.apple.mpegurl'
        : entry.name.endsWith('.ts') ? 'video/mp2t'
        : entry.name.endsWith('.m4s') ? 'video/iso.segment'
        : 'application/octet-stream';
      await putFile(key, full, type);
      uploaded.push(key);
    }
  }
  return uploaded;
}

export async function getStream(key) {
  if (!ready) return fs.createReadStream(path.join(localDir(), key));
  return getClient().getObject(BUCKET, key);
}

export async function statObject(key) {
  if (!ready) {
    const p = path.join(localDir(), key);
    const s = fs.statSync(p);
    return { size: s.size, lastModified: s.mtime };
  }
  return getClient().statObject(BUCKET, key);
}

export async function removePrefix(prefix) {
  if (!ready) { fs.rmSync(path.join(localDir(), prefix), { recursive: true, force: true }); return; }
  const c = getClient();
  const keys = [];
  await new Promise((resolve, reject) => {
    const stream = c.listObjectsV2(BUCKET, prefix, true);
    stream.on('data', (o) => keys.push(o.name));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  if (keys.length) await c.removeObjects(BUCKET, keys);
}

/** Time-limited URL for private assets (originals are not public). */
export async function presign(key, expirySeconds = 3600) {
  if (!ready) return publicUrl(key);
  return getClient().presignedGetObject(BUCKET, key, expirySeconds);
}

/** Stable key layout so renditions live beside their original. */
export const keys = {
  original: (orgId, mediaId, ext) => `org/${orgId}/media/${mediaId}/original${ext}`,
  posterFrame: (orgId, mediaId) => `org/${orgId}/media/${mediaId}/poster.jpg`,
  imageVariant: (orgId, mediaId, width, format) =>
    `org/${orgId}/media/${mediaId}/img/${width}.${format}`,
  hlsRoot: (orgId, mediaId) => `org/${orgId}/media/${mediaId}/hls`,
  hlsMaster: (orgId, mediaId) => `org/${orgId}/media/${mediaId}/hls/master.m3u8`,
  mp4Variant: (orgId, mediaId, height) => `org/${orgId}/media/${mediaId}/mp4/${height}p.mp4`,
};
