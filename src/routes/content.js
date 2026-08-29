import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { db, uid, now, ROOT } from '../lib/db.js';
import { requireAuth, requirePerm, audit } from '../lib/auth.js';
import { keys, putFile, publicUrl, storageReady, removePrefix } from '../lib/storage.js';
import { enqueueTranscode } from '../lib/transcode.js';

export const router = express.Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 200 * 1024 * 1024);
const TYPES = {
  'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image',
  'video/mp4': 'video', 'video/webm': 'video', 'text/html': 'html',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (_r, _f, cb) => cb(null, UPLOAD_DIR),
    filename: (_r, file, cb) => cb(null, `${uid('med')}${path.extname(file.originalname) || ''}`),
  }),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_r, file, cb) =>
    TYPES[file.mimetype] ? cb(null, true) : cb(new Error(`unsupported_type:${file.mimetype}`)),
});

const contentStatus = (org) => (org.approval_required ? 'pending' : 'approved');

/** Media row plus parsed tags and renditions, which is what clients consume. */
export const expandMedia = (m) => ({
  ...m,
  tags: JSON.parse(m.tags || '[]'),
  renditions: m.renditions ? JSON.parse(m.renditions) : null,
});

/* ---------------- media ---------------- */
router.get('/media', requireAuth, (req, res) => {
  const { q, tag, folder, type } = req.query;
  let rows = db.prepare('SELECT * FROM media WHERE org_id = ? ORDER BY created_at DESC').all(req.orgId);
  if (q) rows = rows.filter((m) => m.name.toLowerCase().includes(String(q).toLowerCase()));
  if (tag) rows = rows.filter((m) => JSON.parse(m.tags).includes(tag));
  if (folder) rows = rows.filter((m) => m.folder === folder);
  if (type) rows = rows.filter((m) => m.type === type);
  res.json(rows.map(expandMedia));
});

router.post('/media', requireAuth, requirePerm('content:write'), upload.single('file'), async (req, res, nextFn) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const type = TYPES[req.file.mimetype];
    const id = uid('med');
    const ext = path.extname(req.file.originalname) || path.extname(req.file.filename) || '';
    const displayName = req.body?.name || req.file.originalname;
    const { tags = '[]', folder = '/', duration } = req.body || {};

    // Original goes to object storage; the CDN/MinIO URL is what screens fetch.
    const key = keys.original(req.orgId, id, ext);
    const url = await putFile(key, req.file.path, req.file.mimetype);

    const needsTranscode = type === 'video' || type === 'image';
    db.prepare(
      `INSERT INTO media (id,org_id,name,type,url,bytes,duration,tags,folder,status,storage_key,rendition_status,created_by,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(id, req.orgId, displayName, type, url, req.file.size,
          Number(duration) || (type === 'video' ? 30 : 10),
          typeof tags === 'string' ? tags : JSON.stringify(tags), folder,
          contentStatus(req.org), key, needsTranscode ? 'queued' : 'none', req.user.id, now());
    db.prepare('INSERT INTO media_versions (id,media_id,version,url,bytes,created_at) VALUES (?,?,?,?,?,?)')
      .run(uid('mv'), id, 1, url, req.file.size, now());

    if (needsTranscode) {
      enqueueTranscode({
        type, orgId: req.orgId, mediaId: id, name: displayName,
        sourcePath: req.file.path, cleanup: storageReady(),
      });
    }
    audit(req, 'media.upload', id, { name: displayName, storage: storageReady() ? 'minio' : 'local' });
    res.status(201).json(db.prepare('SELECT * FROM media WHERE id=?').get(id));
  } catch (err) { nextFn(err); }
});

/** Register externally hosted media (CDN URL) without uploading bytes. */
router.post('/media/link', requireAuth, requirePerm('content:write'), (req, res) => {
  const { name, url, type = 'image', duration = 10, tags = [], folder = '/' } = req.body || {};
  if (!name || !url) return res.status(400).json({ error: 'name and url required' });
  if (!['image', 'video', 'html'].includes(type)) return res.status(400).json({ error: 'bad_type' });
  const id = uid('med');
  db.prepare(
    `INSERT INTO media (id,org_id,name,type,url,duration,tags,folder,status,created_by,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, req.orgId, name, type, url, duration, JSON.stringify(tags), folder, contentStatus(req.org), req.user.id, now());
  audit(req, 'media.link', id, { name, url });
  res.status(201).json(db.prepare('SELECT * FROM media WHERE id=?').get(id));
});

router.post('/media/:id/replace', requireAuth, requirePerm('content:write'), upload.single('file'), (req, res) => {
  const m = db.prepare('SELECT * FROM media WHERE id=? AND org_id=?').get(req.params.id, req.orgId);
  if (!m) return res.status(404).json({ error: 'not_found' });
  if (!req.file) return res.status(400).json({ error: 'file required' });
  const version = m.version + 1;
  const url = `/uploads/${req.file.filename}`;
  db.prepare('UPDATE media SET url=?, bytes=?, version=? WHERE id=?').run(url, req.file.size, version, m.id);
  db.prepare('INSERT INTO media_versions (id,media_id,version,url,bytes,created_at) VALUES (?,?,?,?,?,?)')
    .run(uid('mv'), m.id, version, url, req.file.size, now());
  audit(req, 'media.replace', m.id, { version });
  res.json(db.prepare('SELECT * FROM media WHERE id=?').get(m.id));
});

router.get('/media/:id/versions', requireAuth, (req, res) => {
  const m = db.prepare('SELECT * FROM media WHERE id=? AND org_id=?').get(req.params.id, req.orgId);
  if (!m) return res.status(404).json({ error: 'not_found' });
  res.json(db.prepare('SELECT * FROM media_versions WHERE media_id=? ORDER BY version DESC').all(m.id));
});

router.post('/media/:id/restore/:version', requireAuth, requirePerm('content:write'), (req, res) => {
  const m = db.prepare('SELECT * FROM media WHERE id=? AND org_id=?').get(req.params.id, req.orgId);
  const v = m && db.prepare('SELECT * FROM media_versions WHERE media_id=? AND version=?').get(m.id, Number(req.params.version));
  if (!m || !v) return res.status(404).json({ error: 'not_found' });
  const version = m.version + 1;
  db.prepare('UPDATE media SET url=?, bytes=?, version=? WHERE id=?').run(v.url, v.bytes, version, m.id);
  db.prepare('INSERT INTO media_versions (id,media_id,version,url,bytes,created_at) VALUES (?,?,?,?,?,?)')
    .run(uid('mv'), m.id, version, v.url, v.bytes, now());
  audit(req, 'media.restore', m.id, { from_version: v.version });
  res.json(db.prepare('SELECT * FROM media WHERE id=?').get(m.id));
});

router.patch('/media/:id', requireAuth, requirePerm('content:write'), (req, res) => {
  const m = db.prepare('SELECT * FROM media WHERE id=? AND org_id=?').get(req.params.id, req.orgId);
  if (!m) return res.status(404).json({ error: 'not_found' });
  const { name, tags, folder, duration } = req.body || {};
  db.prepare('UPDATE media SET name=?, tags=?, folder=?, duration=? WHERE id=?')
    .run(name ?? m.name, tags ? JSON.stringify(tags) : m.tags, folder ?? m.folder, duration ?? m.duration, m.id);
  audit(req, 'media.update', m.id, req.body);
  res.json(db.prepare('SELECT * FROM media WHERE id=?').get(m.id));
});

router.post('/media/:id/approve', requireAuth, requirePerm('content:approve'), (req, res) => {
  const m = db.prepare('SELECT * FROM media WHERE id=? AND org_id=?').get(req.params.id, req.orgId);
  if (!m) return res.status(404).json({ error: 'not_found' });
  db.prepare("UPDATE media SET status='approved' WHERE id=?").run(m.id);
  audit(req, 'media.approve', m.id);
  res.json(db.prepare('SELECT * FROM media WHERE id=?').get(m.id));
});

router.delete('/media/:id', requireAuth, requirePerm('content:write'), (req, res) => {
  const m = db.prepare('SELECT * FROM media WHERE id=? AND org_id=?').get(req.params.id, req.orgId);
  if (!m) return res.status(404).json({ error: 'not_found' });
  const used = db.prepare('SELECT * FROM playlists WHERE org_id=?').all(req.orgId)
    .filter((p) => JSON.parse(p.items).some((i) => i.media_id === m.id));
  if (used.length) return res.status(409).json({ error: 'media_in_use', playlists: used.map((p) => p.name) });
  db.prepare('DELETE FROM media WHERE id=?').run(m.id);
  void removePrefix(`org/${req.orgId}/media/${m.id}`);
  audit(req, 'media.delete', m.id);
  res.json({ ok: true });
});

/* ---------------- playlists ---------------- */
const expandPlaylist = (p) => {
  const items = JSON.parse(p.items || '[]').map((it) => {
    const m = db.prepare('SELECT id,name,type,url,duration,status FROM media WHERE id=?').get(it.media_id);
    return m ? { ...it, media: m, duration: it.duration || m.duration } : null;
  }).filter(Boolean);
  return { ...p, items, total_duration: items.reduce((a, i) => a + (i.duration || 0), 0) };
};

router.get('/playlists', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM playlists WHERE org_id=? ORDER BY updated_at DESC').all(req.orgId);
  res.json(rows.map(expandPlaylist));
});

router.get('/playlists/:id', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM playlists WHERE id=? AND org_id=?').get(req.params.id, req.orgId);
  if (!p) return res.status(404).json({ error: 'not_found' });
  res.json(expandPlaylist(p));
});

function validateItems(items, orgId) {
  if (!Array.isArray(items)) return { error: 'items must be an array' };
  for (const it of items) {
    if (!it?.media_id) return { error: 'each item needs media_id' };
    const m = db.prepare('SELECT 1 FROM media WHERE id=? AND org_id=?').get(it.media_id, orgId);
    if (!m) return { error: `media_not_found:${it.media_id}` };
  }
  return { ok: true };
}

router.post('/playlists', requireAuth, requirePerm('content:write'), (req, res) => {
  const { name, items = [], branch_id = null } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const v = validateItems(items, req.orgId);
  if (v.error) return res.status(400).json(v);
  const id = uid('pls');
  db.prepare('INSERT INTO playlists (id,org_id,branch_id,name,items,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, req.orgId, branch_id, name, JSON.stringify(items), contentStatus(req.org), now(), now());
  audit(req, 'playlist.create', id, { name });
  res.status(201).json(expandPlaylist(db.prepare('SELECT * FROM playlists WHERE id=?').get(id)));
});

router.patch('/playlists/:id', requireAuth, requirePerm('content:write'), (req, res) => {
  const p = db.prepare('SELECT * FROM playlists WHERE id=? AND org_id=?').get(req.params.id, req.orgId);
  if (!p) return res.status(404).json({ error: 'not_found' });
  const { name, items, branch_id } = req.body || {};
  if (items) { const v = validateItems(items, req.orgId); if (v.error) return res.status(400).json(v); }
  db.prepare('UPDATE playlists SET name=?, items=?, branch_id=?, updated_at=? WHERE id=?')
    .run(name ?? p.name, items ? JSON.stringify(items) : p.items,
         branch_id === undefined ? p.branch_id : branch_id, now(), p.id);
  audit(req, 'playlist.update', p.id, { name, item_count: items?.length });
  res.json(expandPlaylist(db.prepare('SELECT * FROM playlists WHERE id=?').get(p.id)));
});

router.post('/playlists/:id/approve', requireAuth, requirePerm('content:approve'), (req, res) => {
  const p = db.prepare('SELECT * FROM playlists WHERE id=? AND org_id=?').get(req.params.id, req.orgId);
  if (!p) return res.status(404).json({ error: 'not_found' });
  db.prepare("UPDATE playlists SET status='approved' WHERE id=?").run(p.id);
  audit(req, 'playlist.approve', p.id);
  res.json(expandPlaylist(db.prepare('SELECT * FROM playlists WHERE id=?').get(p.id)));
});

router.delete('/playlists/:id', requireAuth, requirePerm('content:write'), (req, res) => {
  const p = db.prepare('SELECT * FROM playlists WHERE id=? AND org_id=?').get(req.params.id, req.orgId);
  if (!p) return res.status(404).json({ error: 'not_found' });
  const inUse = db.prepare('SELECT COUNT(*) c FROM screens WHERE playlist_id=?').get(p.id).c;
  if (inUse) return res.status(409).json({ error: 'playlist_assigned_to_screens', screens: inUse });
  db.prepare('DELETE FROM playlists WHERE id=?').run(p.id);
  audit(req, 'playlist.delete', p.id);
  res.json({ ok: true });
});

/* ---------------- tickers ---------------- */
router.get('/tickers', requireAuth, (req, res) =>
  res.json(db.prepare('SELECT * FROM tickers WHERE org_id=? ORDER BY created_at DESC').all(req.orgId)));

router.post('/tickers', requireAuth, requirePerm('content:write'), (req, res) => {
  const { name, text, position = 'bottom', speed = 60, color = '#ffffff',
          background = '#111827', branch_id = null, start_time = null, end_time = null } = req.body || {};
  if (!name || !text) return res.status(400).json({ error: 'name and text required' });
  if (!['top', 'bottom'].includes(position)) return res.status(400).json({ error: 'position must be top|bottom' });
  const id = uid('tkr');
  db.prepare(
    `INSERT INTO tickers (id,org_id,branch_id,name,text,position,speed,color,background,start_time,end_time,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, req.orgId, branch_id, name, text, position, speed, color, background, start_time, end_time, now());
  audit(req, 'ticker.create', id, { name });
  res.status(201).json(db.prepare('SELECT * FROM tickers WHERE id=?').get(id));
});

router.patch('/tickers/:id', requireAuth, requirePerm('content:write'), (req, res) => {
  const t = db.prepare('SELECT * FROM tickers WHERE id=? AND org_id=?').get(req.params.id, req.orgId);
  if (!t) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  db.prepare('UPDATE tickers SET name=?,text=?,position=?,speed=?,color=?,background=?,start_time=?,end_time=?,branch_id=? WHERE id=?')
    .run(b.name ?? t.name, b.text ?? t.text, b.position ?? t.position, b.speed ?? t.speed,
         b.color ?? t.color, b.background ?? t.background,
         b.start_time === undefined ? t.start_time : b.start_time,
         b.end_time === undefined ? t.end_time : b.end_time,
         b.branch_id === undefined ? t.branch_id : b.branch_id, t.id);
  audit(req, 'ticker.update', t.id, b);
  res.json(db.prepare('SELECT * FROM tickers WHERE id=?').get(t.id));
});

router.delete('/tickers/:id', requireAuth, requirePerm('content:write'), (req, res) => {
  const t = db.prepare('SELECT * FROM tickers WHERE id=? AND org_id=?').get(req.params.id, req.orgId);
  if (!t) return res.status(404).json({ error: 'not_found' });
  db.prepare('UPDATE screens SET ticker_id=NULL WHERE ticker_id=?').run(t.id);
  db.prepare('DELETE FROM tickers WHERE id=?').run(t.id);
  audit(req, 'ticker.delete', t.id);
  res.json({ ok: true });
});
