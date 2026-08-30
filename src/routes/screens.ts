// SOT: pairing, screens, publish, bulk-publish, rollback, device-api
// WHAT:  pairing a TV to a tenant, and everything done to a screen afterwards.
// WHY:   a 4-digit code is short enough to read across a shop floor, so it is only
//        safe because it is device-bound, single-use and short-lived: the token is
//        released to the device that asked for the code, never to whoever guesses it.
// WHERE: content resolution in src/lib/content.ts; delivery in src/lib/hub.ts

import { Hono } from 'hono';
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { branches, pairings, playlists, publishEvents, screens, statusEvents, subscriptions, tickers } from '../db/schema.js';
import type { Screen } from '../db/schema.js';
import { audit, auditActor, branchAllowed, requireAuth, requireDevice, requirePerm, signDevice } from '../lib/auth.js';
import { buildPayload, publishToScreen, publishToScreens, reloadScreen, resolveScreenContent } from '../lib/content.js';
import * as hub from '../lib/hub.js';
import type { AppEnv } from '../lib/http.js';
import { now, uid } from '../lib/ids.js';
import { limitCheck } from '../lib/plans.js';
import { jsonBody, pairingLimiter } from '../lib/ratelimit.js';

export const screensRouter = new Hono<AppEnv>();

const OTP_TTL_MS = Number(process.env.OTP_TTL_MS ?? 3 * 60_000);
const otp4 = (): string => String(Math.floor(1000 + Math.random() * 9000));

/* ================= pairing ================= */

/** The TV asks for a code to show on screen. */
screensRouter.post('/pairing/generate-otp', pairingLimiter, async (c) => {
  const body = await jsonBody(c);
  const deviceId = String(body.device_id ?? uid('dev'));
  const metadata = body.metadata ?? {};

  await db.delete(pairings)
    .where(and(eq(pairings.device_id, deviceId), isNull(pairings.claimed_at)));
  await db.delete(pairings)
    .where(and(lt(pairings.expires_at, now()), isNull(pairings.claimed_at)));

  // With 9000 codes in play, retry until an unexpired one is free rather than
  // handing two devices the same digits.
  let code = otp4();
  for (let i = 0; i < 50; i++) {
    const taken = await db.query.pairings.findFirst({
      where: and(eq(pairings.code, code), sql`${pairings.expires_at} > ${now()}`),
    });
    if (!taken) break;
    code = otp4();
  }

  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
  await db.transaction(async (tx) => {
    // An expired-but-unclaimed row for these digits may still exist; claim it outright.
    await tx.delete(pairings).where(eq(pairings.code, code));
    await tx.insert(pairings).values({
      code, device_id: deviceId, metadata: JSON.stringify(metadata),
      expires_at: expiresAt, created_at: now(),
    });
  });
  return c.json({
    code, device_id: deviceId, expires_at: expiresAt,
    expires_in_seconds: Math.round(OTP_TTL_MS / 1000),
  }, 201);
});

/**
 * The TV polls to learn it has been claimed (the fallback when its socket is not up
 * yet). The response carries the device token, so the caller must prove it is the
 * device that asked for the code — knowing four digits must never be enough.
 */
screensRouter.get('/pairing/status/:code', async (c) => {
  const p = await db.query.pairings.findFirst({ where: eq(pairings.code, c.req.param('code')) });
  if (!p) return c.json({ error: 'not_found' }, 404);
  const deviceId = c.req.query('device_id') ?? c.req.header('x-device-id');
  if (!deviceId || deviceId !== p.device_id) return c.json({ error: 'device_mismatch' }, 403);
  if (!p.claimed_at && p.expires_at < now()) return c.json({ error: 'expired' }, 410);
  return c.json(p.claimed_at
    ? { status: 'paired', screen_id: p.screen_id, device_token: p.device_token }
    : { status: 'waiting', expires_at: p.expires_at });
});

/** The dashboard checks a code, so Add Screen can prefill what the device reported. */
screensRouter.post('/pairing/verify', pairingLimiter, requireAuth, requirePerm('screen:write'), async (c) => {
  const body = await jsonBody(c);
  const p = await db.query.pairings.findFirst({ where: eq(pairings.code, String(body.code ?? '')) });
  if (!p || p.claimed_at) return c.json({ error: 'invalid_code' }, 404);
  if (p.expires_at < now()) return c.json({ error: 'code_expired' }, 410);
  return c.json({
    valid: true, device_id: p.device_id,
    metadata: JSON.parse(p.metadata || '{}'), expires_at: p.expires_at,
  });
});

/* ================= screens ================= */

/** A screen as the dashboard shows it: names resolved, token withheld. */
async function screenView(s: Screen) {
  const branch = await db.query.branches.findFirst({
    where: eq(branches.id, s.branch_id), columns: { name: true },
  });
  const playlist = s.playlist_id
    ? await db.query.playlists.findFirst({ where: eq(playlists.id, s.playlist_id), columns: { name: true } })
    : null;
  const ticker = s.ticker_id
    ? await db.query.tickers.findFirst({ where: eq(tickers.id, s.ticker_id), columns: { name: true } })
    : null;
  return {
    ...s,
    connected: await hub.isConnected(s.id),
    branch_name: branch?.name ?? null,
    playlist_name: playlist?.name ?? null,
    ticker_name: ticker?.name ?? null,
    effective: await resolveScreenContent(s),
    // The device token is a credential; it goes to the device, never to a dashboard.
    device_token: undefined,
  };
}

screensRouter.get('/screens', requireAuth, async (c) => {
  const user = c.get('user');
  let rows = await db.select().from(screens)
    .where(eq(screens.org_id, c.get('orgId'))).orderBy(desc(screens.created_at));

  const branchId = c.req.query('branch_id');
  const status = c.req.query('status');
  if (branchId) rows = rows.filter((s) => s.branch_id === branchId);
  if (status) rows = rows.filter((s) => s.status === status);
  if (user.role === 'branch_manager') rows = rows.filter((s) => user.branch_ids.includes(s.branch_id));
  return c.json(await Promise.all(rows.map(screenView)));
});

const findScreen = (id: string, orgId: string) =>
  db.query.screens.findFirst({ where: and(eq(screens.id, id), eq(screens.org_id, orgId)) });

screensRouter.get('/screens/:id', requireAuth, async (c) => {
  const s = await findScreen(c.req.param('id'), c.get('orgId'));
  if (!s) return c.json({ error: 'not_found' }, 404);
  return c.json({ ...(await screenView(s)), preview: await buildPayload(s) });
});

/** Add New Screen: completes pairing and creates the screen record. */
screensRouter.post('/screens', requireAuth, requirePerm('screen:write'), async (c) => {
  const org = c.get('org');
  const user = c.get('user');
  if (!org) return c.json({ error: 'unauthorized' }, 401);

  const body = await jsonBody(c);
  const name = String(body.name ?? '');
  const branchId = String(body.branch_id ?? '');
  const playlistId = (body.playlist_id as string | null) ?? null;
  const tickerId = (body.ticker_id as string | null) ?? null;

  if (!name || !branchId) return c.json({ error: 'name and branch_id required' }, 400);
  if (!branchAllowed(user, branchId)) return c.json({ error: 'branch_not_assigned' }, 403);

  const branch = await db.query.branches.findFirst({
    where: and(eq(branches.id, branchId), eq(branches.org_id, org.id)),
  });
  if (!branch) return c.json({ error: 'branch_not_found' }, 404);
  if (await db.query.screens.findFirst({
    where: and(eq(screens.branch_id, branchId), eq(screens.name, name)),
  })) return c.json({ error: 'screen_name_taken_in_branch' }, 409);

  const limit = await limitCheck(org, 'screen');
  if (!limit.ok) return c.json(limit, 402);

  if (playlistId && !await db.query.playlists.findFirst({
    where: and(eq(playlists.id, playlistId), eq(playlists.org_id, org.id)),
  })) return c.json({ error: 'playlist_not_found' }, 400);
  if (tickerId && !await db.query.tickers.findFirst({
    where: and(eq(tickers.id, tickerId), eq(tickers.org_id, org.id)),
  })) return c.json({ error: 'ticker_not_found' }, 400);

  let pairing = null;
  const code = body.code === undefined ? null : String(body.code);
  if (code) {
    pairing = await db.query.pairings.findFirst({ where: eq(pairings.code, code) });
    if (!pairing || pairing.claimed_at) return c.json({ error: 'invalid_code' }, 404);
    if (pairing.expires_at < now()) return c.json({ error: 'code_expired' }, 410);
  }

  // What the TV told us about itself wins over what the form guessed.
  const meta = JSON.parse(pairing?.metadata ?? '{}') as Record<string, string>;
  const id = uid('scr');
  await db.insert(screens).values({
    id,
    org_id: org.id,
    branch_id: branchId,
    name,
    playlist_id: playlistId,
    ticker_id: tickerId,
    orientation: meta.orientation ?? String(body.orientation ?? 'landscape'),
    resolution: meta.resolution ?? null,
    os_type: meta.os_type ?? 'web',
    app_version: meta.app_version ?? null,
    location_tag: (body.location_tag as string | null) ?? null,
    status: 'offline',
    created_at: now(),
  });

  const created = await db.query.screens.findFirst({ where: eq(screens.id, id) });
  if (!created) return c.json({ error: 'create_failed' }, 500);

  if (pairing) {
    const deviceToken = signDevice(created);
    await db.transaction(async (tx) => {
      await tx.update(screens).set({ device_token: deviceToken }).where(eq(screens.id, id));
      await tx.update(pairings)
        .set({ claimed_at: now(), screen_id: id, device_token: deviceToken })
        .where(eq(pairings.code, pairing!.code));
    });
  }
  await syncScreenCount(org.id);
  await audit(auditActor(c), 'screen.create', id, { name, branch_id: branchId, paired: !!pairing });

  const fresh = await reloadScreen(id);
  if (!fresh) return c.json({ error: 'create_failed' }, 500);
  const result = await publishToScreen(fresh, { actorId: user.id });
  await hub.broadcastDashboard(org.id, { type: 'screen_added', screen_id: id });
  return c.json({
    ...(await screenView(fresh)),
    paired: !!pairing,
    publish: { publish_id: result.publish_id, delivered: result.delivered },
  }, 201);
});

/** Billing counts screens; keep the subscription's copy in step with reality. */
async function syncScreenCount(orgId: string): Promise<void> {
  await db.update(subscriptions).set({
    screen_count: sql`(SELECT COUNT(*) FROM ${screens} WHERE ${screens.org_id} = ${orgId})`,
  }).where(eq(subscriptions.org_id, orgId));
}

screensRouter.patch('/screens/:id', requireAuth, requirePerm('screen:write'), async (c) => {
  const orgId = c.get('orgId');
  const user = c.get('user');
  const s = await findScreen(c.req.param('id'), orgId);
  if (!s) return c.json({ error: 'not_found' }, 404);
  if (!branchAllowed(user, s.branch_id)) return c.json({ error: 'branch_not_assigned' }, 403);

  const b = await jsonBody(c);
  const nextPlaylist = b.playlist_id === undefined ? s.playlist_id : (b.playlist_id as string | null);
  if (nextPlaylist && !await db.query.playlists.findFirst({
    where: and(eq(playlists.id, nextPlaylist), eq(playlists.org_id, orgId)),
  })) return c.json({ error: 'playlist_not_found' }, 400);

  await db.update(screens).set({
    name: b.name === undefined ? s.name : String(b.name),
    playlist_id: nextPlaylist,
    ticker_id: b.ticker_id === undefined ? s.ticker_id : (b.ticker_id as string | null),
    orientation: b.orientation === undefined ? s.orientation : String(b.orientation),
    location_tag: b.location_tag === undefined ? s.location_tag : String(b.location_tag),
    branch_id: b.branch_id === undefined ? s.branch_id : String(b.branch_id),
    // Remember what was showing, so rollback has something to return to.
    prev_playlist_id: nextPlaylist && nextPlaylist !== s.playlist_id ? s.playlist_id : s.prev_playlist_id,
  }).where(eq(screens.id, s.id));
  await audit(auditActor(c), 'screen.update', s.id, b);

  const fresh = await reloadScreen(s.id);
  if (!fresh) return c.json({ error: 'not_found' }, 404);
  const result = await publishToScreen(fresh, { actorId: user.id });
  return c.json({
    ...(await screenView(fresh)),
    publish: { publish_id: result.publish_id, delivered: result.delivered },
  });
});

/** Unpair: revoke the device token and send the TV back to the pairing screen. */
screensRouter.post('/screens/:id/unpair', requireAuth, requirePerm('screen:write'), async (c) => {
  const s = await findScreen(c.req.param('id'), c.get('orgId'));
  if (!s) return c.json({ error: 'not_found' }, 404);
  await db.update(screens).set({ device_token: null, status: 'offline' }).where(eq(screens.id, s.id));
  await hub.sendTo(s.id, { type: 'unpaired' });
  await audit(auditActor(c), 'screen.unpair', s.id);
  return c.json({ ok: true });
});

screensRouter.delete('/screens/:id', requireAuth, requirePerm('screen:write'), async (c) => {
  const orgId = c.get('orgId');
  const s = await findScreen(c.req.param('id'), orgId);
  if (!s) return c.json({ error: 'not_found' }, 404);
  // Tell the device before the row goes, or it keeps playing a playlist nobody owns.
  await hub.sendTo(s.id, { type: 'unpaired' });
  await db.delete(screens).where(eq(screens.id, s.id));
  await syncScreenCount(orgId);
  await audit(auditActor(c), 'screen.delete', s.id);
  return c.json({ ok: true });
});

/* ================= publish ================= */

screensRouter.post('/screens/:id/publish', requireAuth, requirePerm('content:publish'), async (c) => {
  const user = c.get('user');
  const s = await findScreen(c.req.param('id'), c.get('orgId'));
  if (!s) return c.json({ error: 'not_found' }, 404);
  if (!branchAllowed(user, s.branch_id)) return c.json({ error: 'branch_not_assigned' }, 403);
  const r = await publishToScreen(s, { actorId: user.id });
  await audit(auditActor(c), 'screen.publish', s.id, { publish_id: r.publish_id });
  return c.json({ publish_id: r.publish_id, delivered: r.delivered, payload: r.payload });
});

/** Bulk: assign a playlist or ticker to many screens or whole branches, then publish. */
screensRouter.post('/publish/bulk', requireAuth, requirePerm('content:publish'), async (c) => {
  const orgId = c.get('orgId');
  const user = c.get('user');
  const body = await jsonBody(c);
  const screenIds = Array.isArray(body.screen_ids) ? body.screen_ids as string[] : [];
  const branchIds = Array.isArray(body.branch_ids) ? body.branch_ids as string[] : [];
  const playlistId = body.playlist_id as string | null | undefined;
  const tickerId = body.ticker_id as string | null | undefined;

  let targets = await db.select().from(screens).where(eq(screens.org_id, orgId));
  if (!body.all) {
    targets = targets.filter((s) => screenIds.includes(s.id) || branchIds.includes(s.branch_id));
  }
  // A branch manager's "all" is only ever their own branches.
  if (user.role === 'branch_manager') {
    targets = targets.filter((s) => user.branch_ids.includes(s.branch_id));
  }
  if (!targets.length) return c.json({ error: 'no_target_screens' }, 400);

  if (playlistId && !await db.query.playlists.findFirst({
    where: and(eq(playlists.id, playlistId), eq(playlists.org_id, orgId)),
  })) return c.json({ error: 'playlist_not_found' }, 400);

  for (const s of targets) {
    if (playlistId !== undefined && playlistId !== null) {
      await db.update(screens)
        .set({ prev_playlist_id: s.playlist_id, playlist_id: playlistId })
        .where(eq(screens.id, s.id));
    }
    if (tickerId !== undefined) {
      await db.update(screens).set({ ticker_id: tickerId }).where(eq(screens.id, s.id));
    }
  }

  const fresh: Screen[] = [];
  for (const s of targets) {
    const row = await reloadScreen(s.id);
    if (row) fresh.push(row);
  }
  const results = await publishToScreens(fresh, { actorId: user.id });
  await audit(auditActor(c), 'publish.bulk', null,
    { count: results.length, playlist_id: playlistId, ticker_id: tickerId });
  return c.json({
    targeted: results.length,
    delivered: results.filter((r) => r.delivered).length,
    results,
  });
});

/** Roll a screen back to whatever it was showing before the last change. */
screensRouter.post('/screens/:id/rollback', requireAuth, requirePerm('content:publish'), async (c) => {
  const user = c.get('user');
  const s = await findScreen(c.req.param('id'), c.get('orgId'));
  if (!s) return c.json({ error: 'not_found' }, 404);
  if (!s.prev_playlist_id) return c.json({ error: 'no_previous_state' }, 400);

  // Swap, do not overwrite: rolling back twice returns to where you started.
  await db.update(screens)
    .set({ playlist_id: s.prev_playlist_id, prev_playlist_id: s.playlist_id })
    .where(eq(screens.id, s.id));
  const fresh = await reloadScreen(s.id);
  if (!fresh) return c.json({ error: 'not_found' }, 404);
  const r = await publishToScreen(fresh, { actorId: user.id, source: 'rollback' });
  await audit(auditActor(c), 'screen.rollback', s.id, { to: s.prev_playlist_id });
  return c.json({
    ok: true, publish_id: r.publish_id, delivered: r.delivered, playlist_id: fresh.playlist_id,
  });
});

screensRouter.get('/screens/:id/events', requireAuth, async (c) => {
  const s = await findScreen(c.req.param('id'), c.get('orgId'));
  if (!s) return c.json({ error: 'not_found' }, 404);
  return c.json({
    publishes: await db.select().from(publishEvents)
      .where(eq(publishEvents.screen_id, s.id)).orderBy(desc(publishEvents.created_at)).limit(20),
    status: await db.select().from(statusEvents)
      .where(eq(statusEvents.screen_id, s.id)).orderBy(desc(statusEvents.created_at)).limit(20),
    app_version: s.app_version,
    last_sync_at: s.last_sync_at,
    last_seen_at: s.last_seen_at,
  });
});

/* ================= device (TV client) HTTP ================= */

screensRouter.get('/device/content', requireDevice, async (c) => {
  const screen = c.get('screen');
  await db.update(screens).set({ last_seen_at: now() }).where(eq(screens.id, screen.id));
  return c.json(await buildPayload(screen));
});

screensRouter.post('/device/heartbeat', requireDevice, async (c) => {
  const screen = c.get('screen');
  const body = await jsonBody(c);
  await db.update(screens).set({
    last_seen_at: now(),
    app_version: body.app_version === undefined ? screen.app_version : String(body.app_version),
    resolution: body.resolution === undefined ? screen.resolution : String(body.resolution),
  }).where(eq(screens.id, screen.id));
  return c.json({ ok: true, server_time: now() });
});
