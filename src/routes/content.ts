// SOT: media-library, uploads, versions, approval, playlists, tickers
// WHAT:  the content a screen can be given, and the rules about what may go live.
// WHY:   the original upload is the thing the whole delivery plane derives from, so
//        it goes to object storage before the row is written and the transcode job is
//        queued against that key — a worker on any node can then pick it up.
// WHERE: renditions in src/lib/queue.ts; storage keys in src/lib/storage.ts

import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Hono } from 'hono';
import { and, count, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { media, mediaVersions, playlists, screens, tickers } from '../db/schema.js';
import type { Media, Organization, Playlist } from '../db/schema.js';
import { audit, auditActor, requireAuth, requirePerm } from '../lib/auth.js';
import type { AppEnv } from '../lib/http.js';
import { now, uid } from '../lib/ids.js';
import { ROOT } from '../lib/paths.js';
import { enqueueTranscode } from '../lib/queue.js';
import { jsonBody } from '../lib/ratelimit.js';
import { keys, putFile, removePrefix, storageReady } from '../lib/storage.js';

export const content = new Hono<AppEnv>();

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 200 * 1024 * 1024);

/** Only formats a TV can actually render; anything else is rejected at the door. */
const TYPES: Record<string, 'image' | 'video' | 'html'> = {
  'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image',
  'video/mp4': 'video', 'video/webm': 'video', 'text/html': 'html',
};

/** A tenant with approval turned on gets `pending`; everyone else goes live at once. */
const contentStatus = (org: Organization): string => (org.approval_required ? 'pending' : 'approved');

/** Media row plus parsed tags and renditions, which is what clients consume. */
export const expandMedia = (m: Media) => ({
  ...m,
  tags: JSON.parse(m.tags || '[]') as string[],
  renditions: m.renditions ? JSON.parse(m.renditions) : null,
});

type UploadedFile = { path: string; filename: string; size: number; mimetype: string; originalname: string };

/**
 * Read one multipart upload to disk.
 * Content-Length is checked before the body is touched, so an oversized upload is
 * refused without first being buffered.
 */
async function readUpload(c: { req: { header: (k: string) => string | undefined; formData: () => Promise<FormData> } }):
Promise<{ file?: UploadedFile; fields: Record<string, string>; error?: string; status?: 400 | 413 | 415 }> {
  const declared = Number(c.req.header('content-length') ?? 0);
  if (declared && declared > MAX_BYTES) return { fields: {}, error: 'file_too_large', status: 413 };

  const form = await c.req.formData();
  const fields: Record<string, string> = {};
  let file: UploadedFile | undefined;

  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') { fields[key] = value; continue; }
    if (key !== 'file') continue;
    if (value.size > MAX_BYTES) return { fields, error: 'file_too_large', status: 413 };
    if (!TYPES[value.type]) return { fields, error: `unsupported_type:${value.type}`, status: 415 };

    const filename = `${uid('med')}${path.extname(value.name) || ''}`;
    const dest = path.join(UPLOAD_DIR, filename);
    await pipeline(Readable.fromWeb(value.stream() as never), fs.createWriteStream(dest));
    file = {
      path: dest, filename, size: value.size,
      mimetype: value.type, originalname: value.name,
    };
  }
  if (!file) return { fields, error: 'file required', status: 400 };
  return { file, fields };
}

/* ---------------- media ---------------- */

content.get('/media', requireAuth, async (c) => {
  let rows = await db.select().from(media)
    .where(eq(media.org_id, c.get('orgId'))).orderBy(desc(media.created_at));

  const q = c.req.query('q');
  const tag = c.req.query('tag');
  const folder = c.req.query('folder');
  const type = c.req.query('type');
  if (q) rows = rows.filter((m) => m.name.toLowerCase().includes(q.toLowerCase()));
  if (tag) rows = rows.filter((m) => (JSON.parse(m.tags) as string[]).includes(tag));
  if (folder) rows = rows.filter((m) => m.folder === folder);
  if (type) rows = rows.filter((m) => m.type === type);
  return c.json(rows.map(expandMedia));
});

content.post('/media', requireAuth, requirePerm('content:write'), async (c) => {
  const org = c.get('org');
  if (!org) return c.json({ error: 'unauthorized' }, 401);

  const upload = await readUpload(c);
  if (!upload.file) return c.json({ error: upload.error ?? 'file required' }, upload.status ?? 400);
  const { file, fields } = upload;

  const type = TYPES[file.mimetype]!;
  const id = uid('med');
  const ext = path.extname(file.originalname) || path.extname(file.filename) || '';
  const displayName = fields.name || file.originalname;

  // The original goes to object storage first: its key is what the transcode job and
  // every CDN URL are built from.
  const key = keys.original(org.id, id, ext);
  const url = await putFile(key, file.path, file.mimetype);

  const needsTranscode = type === 'video' || type === 'image';
  await db.insert(media).values({
    id,
    org_id: org.id,
    name: displayName,
    type,
    url,
    bytes: file.size,
    duration: Number(fields.duration) || (type === 'video' ? 30 : 10),
    tags: fields.tags ?? '[]',
    folder: fields.folder ?? '/',
    status: contentStatus(org),
    storage_key: key,
    rendition_status: needsTranscode ? 'queued' : 'none',
    created_by: c.get('user').id,
    created_at: now(),
  });
  await db.insert(mediaVersions).values({
    id: uid('mv'), media_id: id, version: 1, url, bytes: file.size, created_at: now(),
  });

  if (needsTranscode) {
    await enqueueTranscode({
      type, orgId: org.id, mediaId: id, name: displayName,
      sourcePath: file.path,
      // sourceKey is what lets a worker on another node pick this job up.
      sourceKey: key,
      // Only safe to delete the local copy once the bytes are in object storage.
      cleanup: storageReady(),
    });
  }
  await audit(auditActor(c), 'media.upload', id,
    { name: displayName, storage: storageReady() ? 'minio' : 'local' });
  return c.json(await db.query.media.findFirst({ where: eq(media.id, id) }), 201);
});

/** Register externally hosted media (an existing CDN URL) without uploading bytes. */
content.post('/media/link', requireAuth, requirePerm('content:write'), async (c) => {
  const org = c.get('org');
  if (!org) return c.json({ error: 'unauthorized' }, 401);
  const body = await jsonBody(c);
  const name = String(body.name ?? '');
  const url = String(body.url ?? '');
  const type = String(body.type ?? 'image');
  if (!name || !url) return c.json({ error: 'name and url required' }, 400);
  if (!['image', 'video', 'html'].includes(type)) return c.json({ error: 'bad_type' }, 400);

  const id = uid('med');
  await db.insert(media).values({
    id, org_id: org.id, name, type, url,
    duration: Number(body.duration ?? 10),
    tags: JSON.stringify(body.tags ?? []),
    folder: String(body.folder ?? '/'),
    status: contentStatus(org),
    created_by: c.get('user').id,
    created_at: now(),
  });
  await audit(auditActor(c), 'media.link', id, { name, url });
  return c.json(await db.query.media.findFirst({ where: eq(media.id, id) }), 201);
});

const findMedia = (id: string, orgId: string) =>
  db.query.media.findFirst({ where: and(eq(media.id, id), eq(media.org_id, orgId)) });

content.post('/media/:id/replace', requireAuth, requirePerm('content:write'), async (c) => {
  const m = await findMedia(c.req.param('id'), c.get('orgId'));
  if (!m) return c.json({ error: 'not_found' }, 404);
  const upload = await readUpload(c);
  if (!upload.file) return c.json({ error: upload.error ?? 'file required' }, upload.status ?? 400);

  const version = m.version + 1;
  const url = `/uploads/${upload.file.filename}`;
  await db.transaction(async (tx) => {
    await tx.update(media).set({ url, bytes: upload.file!.size, version }).where(eq(media.id, m.id));
    await tx.insert(mediaVersions).values({
      id: uid('mv'), media_id: m.id, version, url, bytes: upload.file!.size, created_at: now(),
    });
  });
  await audit(auditActor(c), 'media.replace', m.id, { version });
  return c.json(await db.query.media.findFirst({ where: eq(media.id, m.id) }));
});

content.get('/media/:id/versions', requireAuth, async (c) => {
  const m = await findMedia(c.req.param('id'), c.get('orgId'));
  if (!m) return c.json({ error: 'not_found' }, 404);
  return c.json(await db.select().from(mediaVersions)
    .where(eq(mediaVersions.media_id, m.id)).orderBy(desc(mediaVersions.version)));
});

content.post('/media/:id/restore/:version', requireAuth, requirePerm('content:write'), async (c) => {
  const m = await findMedia(c.req.param('id'), c.get('orgId'));
  const v = m ? await db.query.mediaVersions.findFirst({
    where: and(eq(mediaVersions.media_id, m.id), eq(mediaVersions.version, Number(c.req.param('version')))),
  }) : undefined;
  if (!m || !v) return c.json({ error: 'not_found' }, 404);

  // Restoring moves forward rather than back: the history stays append-only.
  const version = m.version + 1;
  await db.transaction(async (tx) => {
    await tx.update(media).set({ url: v.url, bytes: v.bytes, version }).where(eq(media.id, m.id));
    await tx.insert(mediaVersions).values({
      id: uid('mv'), media_id: m.id, version, url: v.url, bytes: v.bytes, created_at: now(),
    });
  });
  await audit(auditActor(c), 'media.restore', m.id, { from_version: v.version });
  return c.json(await db.query.media.findFirst({ where: eq(media.id, m.id) }));
});

content.patch('/media/:id', requireAuth, requirePerm('content:write'), async (c) => {
  const m = await findMedia(c.req.param('id'), c.get('orgId'));
  if (!m) return c.json({ error: 'not_found' }, 404);
  const body = await jsonBody(c);
  await db.update(media).set({
    name: body.name === undefined ? m.name : String(body.name),
    tags: body.tags === undefined ? m.tags : JSON.stringify(body.tags),
    folder: body.folder === undefined ? m.folder : String(body.folder),
    duration: body.duration === undefined ? m.duration : Number(body.duration),
  }).where(eq(media.id, m.id));
  await audit(auditActor(c), 'media.update', m.id, body);
  return c.json(await db.query.media.findFirst({ where: eq(media.id, m.id) }));
});

content.post('/media/:id/approve', requireAuth, requirePerm('content:approve'), async (c) => {
  const m = await findMedia(c.req.param('id'), c.get('orgId'));
  if (!m) return c.json({ error: 'not_found' }, 404);
  await db.update(media).set({ status: 'approved' }).where(eq(media.id, m.id));
  await audit(auditActor(c), 'media.approve', m.id);
  return c.json(await db.query.media.findFirst({ where: eq(media.id, m.id) }));
});

content.delete('/media/:id', requireAuth, requirePerm('content:write'), async (c) => {
  const orgId = c.get('orgId');
  const m = await findMedia(c.req.param('id'), orgId);
  if (!m) return c.json({ error: 'not_found' }, 404);

  // Deleting media that a playlist still references would leave a screen with a gap
  // it cannot explain, so the caller is told which playlists to fix first.
  const inUse = (await db.select().from(playlists).where(eq(playlists.org_id, orgId)))
    .filter((p) => (JSON.parse(p.items) as { media_id: string }[]).some((i) => i.media_id === m.id));
  if (inUse.length) return c.json({ error: 'media_in_use', playlists: inUse.map((p) => p.name) }, 409);

  await db.delete(media).where(eq(media.id, m.id));
  // Renditions are derived data; losing them on a failed cleanup costs storage, not
  // correctness, so this does not block the response.
  void removePrefix(`org/${orgId}/media/${m.id}`).catch(() => {});
  await audit(auditActor(c), 'media.delete', m.id);
  return c.json({ ok: true });
});

/* ---------------- playlists ---------------- */

type PlaylistItem = { media_id: string; duration?: number };

/** A playlist with each item's media resolved, which is what the builder renders. */
async function expandPlaylist(p: Playlist) {
  const items = [];
  for (const item of JSON.parse(p.items || '[]') as PlaylistItem[]) {
    const m = await db.query.media.findFirst({
      where: eq(media.id, item.media_id),
      columns: { id: true, name: true, type: true, url: true, duration: true, status: true },
    });
    if (m) items.push({ ...item, media: m, duration: item.duration || m.duration });
  }
  return { ...p, items, total_duration: items.reduce((a, i) => a + (i.duration || 0), 0) };
}

content.get('/playlists', requireAuth, async (c) => {
  const rows = await db.select().from(playlists)
    .where(eq(playlists.org_id, c.get('orgId'))).orderBy(desc(playlists.updated_at));
  return c.json(await Promise.all(rows.map(expandPlaylist)));
});

content.get('/playlists/:id', requireAuth, async (c) => {
  const p = await db.query.playlists.findFirst({
    where: and(eq(playlists.id, c.req.param('id')), eq(playlists.org_id, c.get('orgId'))),
  });
  if (!p) return c.json({ error: 'not_found' }, 404);
  return c.json(await expandPlaylist(p));
});

/** Every item must be media this tenant owns — an id from another org is a 400. */
async function validateItems(items: unknown, orgId: string): Promise<{ ok: true } | { error: string }> {
  if (!Array.isArray(items)) return { error: 'items must be an array' };
  for (const item of items as PlaylistItem[]) {
    if (!item?.media_id) return { error: 'each item needs media_id' };
    const found = await db.query.media.findFirst({
      where: and(eq(media.id, item.media_id), eq(media.org_id, orgId)),
      columns: { id: true },
    });
    if (!found) return { error: `media_not_found:${item.media_id}` };
  }
  return { ok: true };
}

content.post('/playlists', requireAuth, requirePerm('content:write'), async (c) => {
  const org = c.get('org');
  if (!org) return c.json({ error: 'unauthorized' }, 401);
  const body = await jsonBody(c);
  const name = String(body.name ?? '');
  const items = body.items ?? [];
  if (!name) return c.json({ error: 'name required' }, 400);
  const valid = await validateItems(items, org.id);
  if ('error' in valid) return c.json(valid, 400);

  const id = uid('pls');
  await db.insert(playlists).values({
    id, org_id: org.id,
    branch_id: (body.branch_id as string | null) ?? null,
    name, items: JSON.stringify(items),
    status: contentStatus(org), created_at: now(), updated_at: now(),
  });
  await audit(auditActor(c), 'playlist.create', id, { name });
  const created = await db.query.playlists.findFirst({ where: eq(playlists.id, id) });
  return c.json(created ? await expandPlaylist(created) : { error: 'not_found' }, 201);
});

content.patch('/playlists/:id', requireAuth, requirePerm('content:write'), async (c) => {
  const orgId = c.get('orgId');
  const p = await db.query.playlists.findFirst({
    where: and(eq(playlists.id, c.req.param('id')), eq(playlists.org_id, orgId)),
  });
  if (!p) return c.json({ error: 'not_found' }, 404);
  const body = await jsonBody(c);
  if (body.items !== undefined) {
    const valid = await validateItems(body.items, orgId);
    if ('error' in valid) return c.json(valid, 400);
  }
  await db.update(playlists).set({
    name: body.name === undefined ? p.name : String(body.name),
    items: body.items === undefined ? p.items : JSON.stringify(body.items),
    branch_id: body.branch_id === undefined ? p.branch_id : (body.branch_id as string | null),
    updated_at: now(),
  }).where(eq(playlists.id, p.id));
  await audit(auditActor(c), 'playlist.update', p.id,
    { name: body.name, item_count: Array.isArray(body.items) ? body.items.length : undefined });
  const updated = await db.query.playlists.findFirst({ where: eq(playlists.id, p.id) });
  return c.json(updated ? await expandPlaylist(updated) : { error: 'not_found' });
});

content.post('/playlists/:id/approve', requireAuth, requirePerm('content:approve'), async (c) => {
  const p = await db.query.playlists.findFirst({
    where: and(eq(playlists.id, c.req.param('id')), eq(playlists.org_id, c.get('orgId'))),
  });
  if (!p) return c.json({ error: 'not_found' }, 404);
  await db.update(playlists).set({ status: 'approved' }).where(eq(playlists.id, p.id));
  await audit(auditActor(c), 'playlist.approve', p.id);
  const updated = await db.query.playlists.findFirst({ where: eq(playlists.id, p.id) });
  return c.json(updated ? await expandPlaylist(updated) : { error: 'not_found' });
});

content.delete('/playlists/:id', requireAuth, requirePerm('content:write'), async (c) => {
  const p = await db.query.playlists.findFirst({
    where: and(eq(playlists.id, c.req.param('id')), eq(playlists.org_id, c.get('orgId'))),
  });
  if (!p) return c.json({ error: 'not_found' }, 404);
  const [assigned] = await db.select({ c: count() }).from(screens).where(eq(screens.playlist_id, p.id));
  if (assigned?.c) return c.json({ error: 'playlist_assigned_to_screens', screens: assigned.c }, 409);
  await db.delete(playlists).where(eq(playlists.id, p.id));
  await audit(auditActor(c), 'playlist.delete', p.id);
  return c.json({ ok: true });
});

/* ---------------- tickers ---------------- */

content.get('/tickers', requireAuth, async (c) =>
  c.json(await db.select().from(tickers)
    .where(eq(tickers.org_id, c.get('orgId'))).orderBy(desc(tickers.created_at))));

content.post('/tickers', requireAuth, requirePerm('content:write'), async (c) => {
  const body = await jsonBody(c);
  const name = String(body.name ?? '');
  const text = String(body.text ?? '');
  const position = String(body.position ?? 'bottom');
  if (!name || !text) return c.json({ error: 'name and text required' }, 400);
  if (!['top', 'bottom'].includes(position)) return c.json({ error: 'position must be top|bottom' }, 400);

  const id = uid('tkr');
  await db.insert(tickers).values({
    id,
    org_id: c.get('orgId'),
    branch_id: (body.branch_id as string | null) ?? null,
    name, text, position,
    speed: Number(body.speed ?? 60),
    color: String(body.color ?? '#ffffff'),
    background: String(body.background ?? '#111827'),
    start_time: (body.start_time as string | null) ?? null,
    end_time: (body.end_time as string | null) ?? null,
    created_at: now(),
  });
  await audit(auditActor(c), 'ticker.create', id, { name });
  return c.json(await db.query.tickers.findFirst({ where: eq(tickers.id, id) }), 201);
});

content.patch('/tickers/:id', requireAuth, requirePerm('content:write'), async (c) => {
  const t = await db.query.tickers.findFirst({
    where: and(eq(tickers.id, c.req.param('id')), eq(tickers.org_id, c.get('orgId'))),
  });
  if (!t) return c.json({ error: 'not_found' }, 404);
  const b = await jsonBody(c);
  await db.update(tickers).set({
    name: b.name === undefined ? t.name : String(b.name),
    text: b.text === undefined ? t.text : String(b.text),
    position: b.position === undefined ? t.position : String(b.position),
    speed: b.speed === undefined ? t.speed : Number(b.speed),
    color: b.color === undefined ? t.color : String(b.color),
    background: b.background === undefined ? t.background : String(b.background),
    // null is a meaningful value here — it clears the window — so only `undefined`
    // means "leave it alone".
    start_time: b.start_time === undefined ? t.start_time : (b.start_time as string | null),
    end_time: b.end_time === undefined ? t.end_time : (b.end_time as string | null),
    branch_id: b.branch_id === undefined ? t.branch_id : (b.branch_id as string | null),
  }).where(eq(tickers.id, t.id));
  await audit(auditActor(c), 'ticker.update', t.id, b);
  return c.json(await db.query.tickers.findFirst({ where: eq(tickers.id, t.id) }));
});

content.delete('/tickers/:id', requireAuth, requirePerm('content:write'), async (c) => {
  const t = await db.query.tickers.findFirst({
    where: and(eq(tickers.id, c.req.param('id')), eq(tickers.org_id, c.get('orgId'))),
  });
  if (!t) return c.json({ error: 'not_found' }, 404);
  await db.transaction(async (tx) => {
    // Detach it from every screen first, or the delete trips the foreign key.
    await tx.update(screens).set({ ticker_id: null }).where(eq(screens.ticker_id, t.id));
    await tx.delete(tickers).where(eq(tickers.id, t.id));
  });
  await audit(auditActor(c), 'ticker.delete', t.id);
  return c.json({ ok: true });
});
