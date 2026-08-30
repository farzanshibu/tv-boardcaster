// SOT: server-entrypoint, hono-app, media-origin, websocket-upgrade, background-work
// WHAT:  the data plane — the Hono API, the media origin, and the WebSocket hub —
//        composed onto one Node HTTP server that Next.js also gets to use.
// WHY:   a TV needs a raw WebSocket upgrade, which Next alone does not serve, so one
//        process owns the API and socket planes and hands everything else to Next.
// HOW:   Hono answers /api, /media and /uploads through the Node adapter; every other
//        path goes to the Next request handler once server.ts at the repo root
//        attaches it. The upgrade handshake is resolved asynchronously because a
//        device token has to be checked against the database first.
// WHERE: routers in src/routes/; delivery plane in src/lib/hub.ts

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { Duplex } from 'node:stream';
import { getRequestListener } from '@hono/node-server';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db, runMigrations } from './db/client.js';
import { notifications, playEvents, publishEvents, screens } from './db/schema.js';
import { verify } from './lib/auth.js';
import * as bus from './lib/bus.js';
import { buildPayload } from './lib/content.js';
import * as hub from './lib/hub.js';
import type { AppEnv } from './lib/http.js';
import { now, uid } from './lib/ids.js';
import { ROOT } from './lib/paths.js';
import { healthTick, startJobs } from './lib/jobs.js';
import { queueStats, startWorkers } from './lib/queue.js';
import {
  cacheControlFor, contentTypeFor, driver as storageDriver, getStream, initStorage, statObject,
} from './lib/storage.js';
import { WebSocketServer } from './lib/ws-server.js';
import type { WebSocket } from 'ws';

import { accounts } from './routes/accounts.js';
import { billing } from './routes/billing.js';
import { content } from './routes/content.js';
import { insights } from './routes/insights.js';
import { schedulesRouter } from './routes/schedules.js';
import { screensRouter } from './routes/screens.js';
import { superadmin } from './routes/superadmin.js';

await runMigrations();

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');

export const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
});

app.get('/api/health', async (c) => c.json({
  ok: true,
  service: 'brandcast-tv',
  node_id: bus.NODE_ID,
  database: 'postgres',
  bus: bus.driver(),
  storage: storageDriver(),
  transcode: await queueStats().catch(() => null),
  time: now(),
}));

// Every router declares its own paths, so they all mount at the same prefix.
for (const router of [accounts, content, screensRouter, schedulesRouter, insights, billing, superadmin]) {
  app.route('/api', router);
}

/**
 * Object-storage origin. In production a CDN fronts MinIO and screens never reach
 * this, but locally it lets a TV stream HLS without exposing MinIO's port.
 */
app.get('/media/*', async (c) => {
  const key = c.req.path.slice('/media/'.length);
  try {
    const stat = await statObject(key).catch(() => null);
    const stream = await getStream(key);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        'Content-Type': contentTypeFor(key),
        // The same policy the objects carry in storage, so this origin and the CDN
        // agree: playlists revalidate, immutable segments are cached hard.
        'Cache-Control': cacheControlFor(key),
        'Access-Control-Allow-Origin': '*',
        ...(stat?.size ? { 'Content-Length': String(stat.size) } : {}),
      },
    });
  } catch {
    return c.json({ error: 'not_found' }, 404);
  }
});

/** Local-disk fallback for media, used when object storage is unavailable. */
app.get('/uploads/*', async (c) => {
  const rel = decodeURIComponent(c.req.path.slice('/uploads/'.length));
  const full = path.resolve(UPLOAD_DIR, rel);
  // A key is attacker-influenced, so refuse anything that escapes the directory.
  if (!full.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) return c.json({ error: 'not_found' }, 404);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return c.json({ error: 'not_found' }, 404);
  const stat = fs.statSync(full);
  return new Response(Readable.toWeb(fs.createReadStream(full)) as ReadableStream, {
    headers: {
      'Content-Type': contentTypeFor(full),
      'Cache-Control': cacheControlFor(full),
      'Access-Control-Allow-Origin': '*',
      'Content-Length': String(stat.size),
    },
  });
});

app.onError((err, c) => {
  if (String(err.message).startsWith('unsupported_type')) return c.json({ error: err.message }, 415);
  console.error('[error]', err);
  return c.json({ error: 'internal_error' }, 500);
});

/* ------------------------------------------------------------------ *
 * HTTP server: Hono owns the data plane, Next owns the UI
 * ------------------------------------------------------------------ */

export type NextHandler = (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;

let nextHandler: NextHandler | null = null;
export function attachNext(handler: NextHandler): void { nextHandler = handler; }

const honoListener = getRequestListener(app.fetch);
const OWNED = ['/api', '/media/', '/uploads/'];
const ownedByApi = (url: string): boolean =>
  OWNED.some((p) => url === p || url.startsWith(p.endsWith('/') ? p : `${p}/`));

export const server = http.createServer((req, res) => {
  const url = req.url ?? '/';
  if (ownedByApi(url)) { void honoListener(req, res); return; }
  // Until the UI is attached these paths 503 rather than silently 404.
  if (!nextHandler) { res.statusCode = 503; res.end('UI not attached'); return; }
  nextHandler(req, res).catch((err: Error) => {
    console.error('[next]', err);
    if (!res.headersSent) { res.statusCode = 500; res.end('internal_error'); }
  });
});

/* ------------------------------------------------------------------ *
 * WebSocket plane
 * ------------------------------------------------------------------ */

const wss = new WebSocketServer({ noServer: true });

// Authorising a device is a database round trip, so the handshake is resolved after
// an await. The socket is paused meanwhile: `ws` needs the bytes that arrive in the
// gap, and they would otherwise be dropped.
server.on('upgrade', (req, socket, head) => {
  socket.pause();
  void authorizeUpgrade(req, socket, head).catch((err: Error) => {
    console.error('[ws] upgrade failed', err);
    socket.destroy();
  });
});

async function authorizeUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
  const reject = (line: string): void => {
    socket.write(`HTTP/1.1 ${line}\r\n\r\n`);
    socket.destroy();
  };

  const url = new URL(req.url ?? '/', 'http://x');
  // Anything that is not one of our two socket paths is not ours to answer.
  if (!['/device/session', '/dashboard/session'].includes(url.pathname)) { socket.destroy(); return; }
  const token = url.searchParams.get('token');
  const payload = token ? verify(token) : null;
  if (!payload || !token) return reject('401 Unauthorized');

  if (url.pathname === '/device/session') {
    // The stored token must still match: unpairing has to cut the socket off, not
    // wait for the JWT to expire a year from now.
    const screen = await db.query.screens.findFirst({ where: eq(screens.id, payload.sub) });
    if (payload.kind !== 'device' || !screen || screen.device_token !== token) {
      return reject('401 Unauthorized');
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      socket.resume();
      void attachDevice(ws, screen.id);
    });
    return;
  }

  if (payload.kind === 'device') return reject('403 Forbidden');
  wss.handleUpgrade(req, socket, head, (ws) => {
    socket.resume();
    const orgId = payload.act_org || payload.org_id || '';
    void hub.registerDashboard(ws, orgId).then(() => {
      ws.on('close', () => { void hub.unregisterDashboard(ws); });
      ws.send(JSON.stringify({ type: 'hello', org_id: orgId }));
    });
  });
}

async function attachDevice(ws: WebSocket, screenId: string): Promise<void> {
  const screen = await db.query.screens.findFirst({ where: eq(screens.id, screenId) });
  if (!screen) { ws.close(); return; }

  await hub.register(screenId, ws);
  await db.update(screens).set({ status: 'online', last_seen_at: now() }).where(eq(screens.id, screenId));
  await hub.logStatus(screen, 'online');
  await hub.broadcastDashboard(screen.org_id, {
    type: 'screen_status', screen_id: screenId, status: 'online',
  });
  // Send content immediately: a TV that just woke up should not wait for a publish.
  ws.send(JSON.stringify({ type: 'content', publish_id: null, payload: await buildPayload(screen) }));

  ws.on('message', (raw) => { void onDeviceMessage(ws, screenId, raw.toString()); });
  ws.on('close', () => { void onDeviceClose(screenId, ws); });
}

type DeviceMessage = {
  type?: string;
  app_version?: string;
  resolution?: string;
  publish_id?: string;
  media_id?: string;
  playlist_id?: string;
  duration?: number;
  detail?: string;
};

async function onDeviceMessage(ws: WebSocket, screenId: string, raw: string): Promise<void> {
  let msg: DeviceMessage;
  try { msg = JSON.parse(raw) as DeviceMessage; } catch { return; }
  const s = await db.query.screens.findFirst({ where: eq(screens.id, screenId) });
  if (!s) return;

  if (msg.type === 'heartbeat') {
    await db.update(screens).set({
      last_seen_at: now(),
      app_version: msg.app_version ?? s.app_version,
      resolution: msg.resolution ?? s.resolution,
    }).where(eq(screens.id, screenId));
    ws.send(JSON.stringify({ type: 'heartbeat_ack', server_time: now() }));
  }

  if (msg.type === 'ack') {
    // Rendered, not just delivered: the device has the content on screen.
    if (msg.publish_id) {
      await db.update(publishEvents).set({ status: 'rendered', rendered_at: now() })
        .where(eq(publishEvents.id, msg.publish_id));
    }
    await db.update(screens).set({ last_sync_at: now() }).where(eq(screens.id, screenId));
    await hub.logStatus(s, 'sync', `publish ${msg.publish_id ?? 'initial'} rendered`);
    await hub.broadcastDashboard(s.org_id, {
      type: 'publish', screen_id: screenId, publish_id: msg.publish_id, status: 'rendered',
    });
  }

  if (msg.type === 'play') {
    await db.insert(playEvents).values({
      id: uid('ply'), org_id: s.org_id, screen_id: screenId,
      media_id: msg.media_id ?? null, playlist_id: msg.playlist_id ?? null,
      duration: Math.round(msg.duration ?? 0), created_at: now(),
    });
  }

  if (msg.type === 'error') await hub.logStatus(s, 'error', String(msg.detail ?? '').slice(0, 500));
}

async function onDeviceClose(screenId: string, ws: WebSocket): Promise<void> {
  await hub.unregister(screenId, ws);
  const s = await db.query.screens.findFirst({ where: eq(screens.id, screenId) });
  if (!s || s.status !== 'online') return;
  // Across a fleet another node may still hold a session for this screen, and only
  // a stale heartbeat proves otherwise — that is healthTick's job, not this one's.
  if (await hub.isConnected(screenId)) return;

  await db.update(screens).set({ status: 'offline' }).where(eq(screens.id, screenId));
  await hub.logStatus(s, 'offline');
  await hub.broadcastDashboard(s.org_id, {
    type: 'screen_status', screen_id: screenId, status: 'offline',
  });
  await db.insert(notifications).values({
    id: uid('ntf'), org_id: s.org_id, kind: 'screen_offline',
    message: `Screen "${s.name}" is offline`, read: 0, created_at: now(),
  });
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

export async function startBackgroundWork() {
  const messaging = await bus.initBus();
  console.log(`[bus] driver=${messaging.driver} node=${messaging.node_id}`);
  const storage = await initStorage();
  console.log(`[storage] driver=${storage.driver}${storage.bucket ? ` bucket=${storage.bucket}` : ''}`);
  console.log('[db] driver=postgres');
  const workers = startWorkers();
  console.log(`[transcode] workers=${workers}`);
  startJobs();
  await healthTick();
  return { storage, bus: messaging, workers };
}

// The Next entry point (server.ts at the repo root) owns listen(). Running this file
// directly still works for the API-only test suites.
if (process.env.API_ONLY === '1') {
  const PORT = Number(process.env.PORT ?? 4000);
  await startBackgroundWork();
  server.listen(PORT, () => console.log(`Brandcast API on :${PORT}`));
}
