import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { db, migrate, uid, now, ROOT } from './lib/db.js';
import { verify } from './lib/auth.js';
import * as hub from './lib/hub.js';
import { startJobs, healthTick } from './lib/jobs.js';
import { getStream, statObject, initStorage, driver } from './lib/storage.js';
import { buildPayload } from './lib/content.js';

import { router as accounts } from './routes/accounts.js';
import { router as content } from './routes/content.js';
import { router as screens } from './routes/screens.js';
import { router as schedules } from './routes/schedules.js';
import { router as insights } from './routes/insights.js';
import { router as superadmin } from './routes/superadmin.js';

migrate();

export const app = express();
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.get('/api/health', (_req, res) =>
  res.json({ ok: true, service: 'brandcast-tv', storage: driver(), time: now() }));

app.use('/api', accounts);
app.use('/api', content);
app.use('/api', screens);
app.use('/api', schedules);
app.use('/api', insights);
app.use('/api', superadmin);

app.use('/uploads', express.static(process.env.UPLOAD_DIR || path.join(ROOT, 'uploads'), { maxAge: '7d', immutable: true }));

// Object-storage origin. In production a CDN fronts MinIO and screens never hit this;
// locally it lets a TV stream HLS without exposing MinIO's port.
const MEDIA_TYPES = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t', '.m4s': 'video/iso.segment', '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
};
app.get(/^\/media\/(.+)/, async (req, res) => {
  const key = req.params[0];
  try {
    const ext = path.extname(key).toLowerCase();
    const stat = await statObject(key).catch(() => null);
    res.setHeader('Content-Type', MEDIA_TYPES[ext] || 'application/octet-stream');
    // Playlists must revalidate; immutable segments can be cached hard.
    res.setHeader('Cache-Control', ext === '.m3u8' ? 'public, max-age=10' : 'public, max-age=31536000, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (stat?.size) res.setHeader('Content-Length', String(stat.size));
    const stream = await getStream(key);
    stream.on('error', () => res.status(404).end());
    stream.pipe(res);
  } catch {
    res.status(404).json({ error: 'not_found' });
  }
});

// Everything that is not /api or /uploads is owned by Next.js. attachNext() installs
// the handler; until then those paths 503 rather than silently 404.
let nextHandler = null;
export function attachNext(handler) { nextHandler = handler; }
app.use((req, res, nextFn) => {
  if (!nextHandler) return res.status(503).send('UI not attached');
  nextHandler(req, res).catch(nextFn);
});

app.use((err, _req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file_too_large' });
  if (String(err?.message || '').startsWith('unsupported_type'))
    return res.status(415).json({ error: err.message });
  console.error('[error]', err);
  res.status(500).json({ error: 'internal_error' });
});

export const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (!['/device/session', '/dashboard/session'].includes(url.pathname)) return socket.destroy();
  const token = url.searchParams.get('token');
  const payload = token && verify(token);
  if (!payload) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }

  if (url.pathname === '/device/session') {
    const screen = db.prepare('SELECT * FROM screens WHERE id=? AND device_token=?').get(payload.sub, token);
    if (payload.kind !== 'device' || !screen) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
    return wss.handleUpgrade(req, socket, head, (ws) => attachDevice(ws, screen.id));
  }
  if (payload.kind === 'device') { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, (ws) => {
    hub.registerDashboard(ws, payload.act_org || payload.org_id);
    ws.on('close', () => hub.unregisterDashboard(ws));
    ws.send(JSON.stringify({ type: 'hello', org_id: payload.act_org || payload.org_id }));
  });
});

function attachDevice(ws, screenId) {
  const screen = db.prepare('SELECT * FROM screens WHERE id=?').get(screenId);
  hub.register(screenId, ws);
  db.prepare("UPDATE screens SET status='online', last_seen_at=? WHERE id=?").run(now(), screenId);
  hub.logStatus(screen, 'online');
  hub.broadcastDashboard(screen.org_id, { type: 'screen_status', screen_id: screenId, status: 'online' });
  ws.send(JSON.stringify({ type: 'content', publish_id: null, payload: buildPayload(screen) }));

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const s = db.prepare('SELECT * FROM screens WHERE id=?').get(screenId);
    if (!s) return;

    if (msg.type === 'heartbeat') {
      db.prepare('UPDATE screens SET last_seen_at=?, app_version=?, resolution=? WHERE id=?')
        .run(now(), msg.app_version || s.app_version, msg.resolution || s.resolution, screenId);
      ws.send(JSON.stringify({ type: 'heartbeat_ack', server_time: now() }));
    }

    if (msg.type === 'ack') {
      db.prepare("UPDATE publish_events SET status='rendered', rendered_at=? WHERE id=?").run(now(), msg.publish_id);
      db.prepare('UPDATE screens SET last_sync_at=? WHERE id=?').run(now(), screenId);
      hub.logStatus(s, 'sync', `publish ${msg.publish_id || 'initial'} rendered`);
      hub.broadcastDashboard(s.org_id, { type: 'publish', screen_id: screenId, publish_id: msg.publish_id, status: 'rendered' });
    }

    if (msg.type === 'play') {
      db.prepare('INSERT INTO play_events (id,org_id,screen_id,media_id,playlist_id,duration,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(uid('ply'), s.org_id, screenId, msg.media_id || null, msg.playlist_id || null, Math.round(msg.duration || 0), now());
    }

    if (msg.type === 'error') hub.logStatus(s, 'error', String(msg.detail || '').slice(0, 500));
  });

  ws.on('close', () => {
    hub.unregister(screenId, ws);
    const s = db.prepare('SELECT * FROM screens WHERE id=?').get(screenId);
    if (!s || s.status !== 'online') return;
    db.prepare("UPDATE screens SET status='offline' WHERE id=?").run(screenId);
    hub.logStatus(s, 'offline');
    hub.broadcastDashboard(s.org_id, { type: 'screen_status', screen_id: screenId, status: 'offline' });
    db.prepare('INSERT INTO notifications (id,org_id,kind,message,read,created_at) VALUES (?,?,?,?,0,?)')
      .run(uid('ntf'), s.org_id, 'screen_offline', `Screen "${s.name}" is offline`, now());
  });
}

export async function startBackgroundWork() {
  const storage = await initStorage();
  console.log(`[storage] driver=${storage.driver}${storage.bucket ? ` bucket=${storage.bucket}` : ''}`);
  startJobs();
  healthTick();
  return storage;
}

// The Next.js entry point (server.js at the repo root) owns listen(). Running this
// file directly still works for the API-only test suites.
if (process.env.API_ONLY === '1') {
  const PORT = Number(process.env.PORT || 4000);
  await startBackgroundWork();
  server.listen(PORT, () => console.log(`Brandcast API on :${PORT}`));
}
