import express from 'express';
import { db, uid, now } from '../lib/db.js';
import { requireAuth, requirePerm, requireDevice, audit, signDevice, branchAllowed } from '../lib/auth.js';
import { limitCheck } from '../lib/plans.js';
import { buildPayload, publishToScreen, publishToScreens, resolveScreenContent } from '../lib/content.js';
import * as hub from '../lib/hub.js';
import { pairingLimiter } from '../lib/ratelimit.js';

export const router = express.Router();

const OTP_TTL_MS = Number(process.env.OTP_TTL_MS || 3 * 60_000);
const otp4 = () => String(Math.floor(1000 + Math.random() * 9000));

/* ================= pairing ================= */

/** TV app requests a pairing code. */
router.post('/pairing/generate-otp', pairingLimiter, (req, res) => {
  const { device_id = uid('dev'), metadata = {} } = req.body || {};
  db.prepare("DELETE FROM pairings WHERE device_id=? AND claimed_at IS NULL").run(device_id);
  db.prepare("DELETE FROM pairings WHERE expires_at < ? AND claimed_at IS NULL").run(now());
  let code;
  for (let i = 0; i < 50; i++) {
    code = otp4();
    if (!db.prepare('SELECT 1 FROM pairings WHERE code=? AND expires_at > ?').get(code, now())) break;
  }
  const expires_at = new Date(Date.now() + OTP_TTL_MS).toISOString();
  db.prepare('INSERT OR REPLACE INTO pairings (code,device_id,metadata,expires_at,created_at) VALUES (?,?,?,?,?)')
    .run(code, device_id, JSON.stringify(metadata), expires_at, now());
  res.status(201).json({ code, device_id, expires_at, expires_in_seconds: Math.round(OTP_TTL_MS / 1000) });
});

/** TV app polls to learn it has been claimed (fallback when WS not yet open).
 *  Requires the caller's own device_id: the response carries the device token,
 *  so knowing only the 4-digit code must never be enough to claim it. */
router.get('/pairing/status/:code', (req, res) => {
  const p = db.prepare('SELECT * FROM pairings WHERE code=?').get(req.params.code);
  if (!p) return res.status(404).json({ error: 'not_found' });
  const deviceId = req.query.device_id || req.headers['x-device-id'];
  if (!deviceId || deviceId !== p.device_id) return res.status(403).json({ error: 'device_mismatch' });
  if (!p.claimed_at && p.expires_at < now()) return res.status(410).json({ error: 'expired' });
  res.json(p.claimed_at
    ? { status: 'paired', screen_id: p.screen_id, device_token: p.device_token }
    : { status: 'waiting', expires_at: p.expires_at });
});

/** Dashboard verifies OTP: returns the pending device so the Add Screen modal can be filled. */
router.post('/pairing/verify', pairingLimiter, requireAuth, requirePerm('screen:write'), (req, res) => {
  const code = String(req.body?.code || '');
  const p = db.prepare('SELECT * FROM pairings WHERE code=?').get(code);
  if (!p || p.claimed_at) return res.status(404).json({ error: 'invalid_code' });
  if (p.expires_at < now()) return res.status(410).json({ error: 'code_expired' });
  res.json({ valid: true, device_id: p.device_id, metadata: JSON.parse(p.metadata || '{}'), expires_at: p.expires_at });
});

/* ================= screens ================= */

const screenView = (s) => ({
  ...s,
  connected: hub.isConnected(s.id),
  branch_name: db.prepare('SELECT name FROM branches WHERE id=?').get(s.branch_id)?.name || null,
  playlist_name: s.playlist_id ? db.prepare('SELECT name FROM playlists WHERE id=?').get(s.playlist_id)?.name : null,
  ticker_name: s.ticker_id ? db.prepare('SELECT name FROM tickers WHERE id=?').get(s.ticker_id)?.name : null,
  effective: resolveScreenContent(s),
  device_token: undefined,
});

router.get('/screens', requireAuth, (req, res) => {
  let rows = db.prepare('SELECT * FROM screens WHERE org_id=? ORDER BY created_at DESC').all(req.orgId);
  if (req.query.branch_id) rows = rows.filter((s) => s.branch_id === req.query.branch_id);
  if (req.query.status) rows = rows.filter((s) => s.status === req.query.status);
  if (req.user.role === 'branch_manager') rows = rows.filter((s) => req.user.branch_ids.includes(s.branch_id));
  res.json(rows.map(screenView));
});

router.get('/screens/:id', requireAuth, (req, res) => {
  const s = db.prepare('SELECT * FROM screens WHERE id=? AND org_id=?').get(req.params.id, req.orgId);
  if (!s) return res.status(404).json({ error: 'not_found' });
  res.json({ ...screenView(s), preview: buildPayload(s) });
});

/** Add New Screen: completes pairing and creates the screen record. */
router.post('/screens', requireAuth, requirePerm('screen:write'), (req, res) => {
  const { code, name, branch_id, playlist_id = null, ticker_id = null,
          orientation = 'landscape', location_tag = null } = req.body || {};
  if (!name || !branch_id) return res.status(400).json({ error: 'name and branch_id required' });
  if (!branchAllowed(req.user, branch_id)) return res.status(403).json({ error: 'branch_not_assigned' });

  const branch = db.prepare('SELECT * FROM branches WHERE id=? AND org_id=?').get(branch_id, req.orgId);
  if (!branch) return res.status(404).json({ error: 'branch_not_found' });
  if (db.prepare('SELECT 1 FROM screens WHERE branch_id=? AND name=?').get(branch_id, name))
    return res.status(409).json({ error: 'screen_name_taken_in_branch' });

  const lim = limitCheck(req.org, 'screen');
  if (!lim.ok) return res.status(402).json(lim);

  if (playlist_id && !db.prepare('SELECT 1 FROM playlists WHERE id=? AND org_id=?').get(playlist_id, req.orgId))
    return res.status(400).json({ error: 'playlist_not_found' });
  if (ticker_id && !db.prepare('SELECT 1 FROM tickers WHERE id=? AND org_id=?').get(ticker_id, req.orgId))
    return res.status(400).json({ error: 'ticker_not_found' });

  let pairing = null;
  if (code) {
    pairing = db.prepare('SELECT * FROM pairings WHERE code=?').get(String(code));
    if (!pairing || pairing.claimed_at) return res.status(404).json({ error: 'invalid_code' });
    if (pairing.expires_at < now()) return res.status(410).json({ error: 'code_expired' });
  }

  const meta = JSON.parse(pairing?.metadata || '{}');
  const id = uid('scr');
  db.prepare(
    `INSERT INTO screens (id,org_id,branch_id,name,playlist_id,ticker_id,orientation,resolution,os_type,app_version,location_tag,status,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, req.orgId, branch_id, name, playlist_id, ticker_id,
        meta.orientation || orientation, meta.resolution || null, meta.os_type || 'web',
        meta.app_version || null, location_tag, 'offline', now());

  const screen = db.prepare('SELECT * FROM screens WHERE id=?').get(id);
  let device_token = null;
  if (pairing) {
    device_token = signDevice(screen);
    db.prepare('UPDATE screens SET device_token=? WHERE id=?').run(device_token, id);
    db.prepare('UPDATE pairings SET claimed_at=?, screen_id=?, device_token=? WHERE code=?')
      .run(now(), id, device_token, pairing.code);
  }
  db.prepare('UPDATE subscriptions SET screen_count=(SELECT COUNT(*) FROM screens WHERE org_id=?) WHERE org_id=?')
    .run(req.orgId, req.orgId);
  audit(req, 'screen.create', id, { name, branch_id, paired: !!pairing });

  const fresh = db.prepare('SELECT * FROM screens WHERE id=?').get(id);
  const result = publishToScreen(fresh, { actorId: req.user.id });
  hub.broadcastDashboard(req.orgId, { type: 'screen_added', screen_id: id });
  res.status(201).json({ ...screenView(fresh), paired: !!pairing, publish: { publish_id: result.publish_id, delivered: result.delivered } });
});

router.patch('/screens/:id', requireAuth, requirePerm('screen:write'), (req, res) => {
  const s = db.prepare('SELECT * FROM screens WHERE id=? AND org_id=?').get(req.params.id, req.orgId);
  if (!s) return res.status(404).json({ error: 'not_found' });
  if (!branchAllowed(req.user, s.branch_id)) return res.status(403).json({ error: 'branch_not_assigned' });
  const b = req.body || {};
  if (b.playlist_id && !db.prepare('SELECT 1 FROM playlists WHERE id=? AND org_id=?').get(b.playlist_id, req.orgId))
    return res.status(400).json({ error: 'playlist_not_found' });
  db.prepare('UPDATE screens SET name=?, playlist_id=?, ticker_id=?, orientation=?, location_tag=?, branch_id=?, prev_playlist_id=? WHERE id=?')
    .run(b.name ?? s.name,
         b.playlist_id === undefined ? s.playlist_id : b.playlist_id,
         b.ticker_id === undefined ? s.ticker_id : b.ticker_id,
         b.orientation ?? s.orientation, b.location_tag ?? s.location_tag,
         b.branch_id ?? s.branch_id,
         b.playlist_id && b.playlist_id !== s.playlist_id ? s.playlist_id : s.prev_playlist_id,
         s.id);
  audit(req, 'screen.update', s.id, b);
  const fresh = db.prepare('SELECT * FROM screens WHERE id=?').get(s.id);
  const result = publishToScreen(fresh, { actorId: req.user.id });
  res.json({ ...screenView(fresh), publish: { publish_id: result.publish_id, delivered: result.delivered } });
});

/** Unpair: revoke device token, force TV back to OTP screen. */
router.post('/screens/:id/unpair', requireAuth, requirePerm('screen:write'), (req, res) => {
  const s = db.prepare('SELECT * FROM screens WHERE id=? AND org_id=?').get(req.params.id, req.orgId);
  if (!s) return res.status(404).json({ error: 'not_found' });
  db.prepare("UPDATE screens SET device_token=NULL, status='offline' WHERE id=?").run(s.id);
  hub.sendTo(s.id, { type: 'unpaired' });
  audit(req, 'screen.unpair', s.id);
  res.json({ ok: true });
});

router.delete('/screens/:id', requireAuth, requirePerm('screen:write'), (req, res) => {
  const s = db.prepare('SELECT * FROM screens WHERE id=? AND org_id=?').get(req.params.id, req.orgId);
  if (!s) return res.status(404).json({ error: 'not_found' });
  hub.sendTo(s.id, { type: 'unpaired' });
  db.prepare('DELETE FROM screens WHERE id=?').run(s.id);
  db.prepare('UPDATE subscriptions SET screen_count=(SELECT COUNT(*) FROM screens WHERE org_id=?) WHERE org_id=?')
    .run(req.orgId, req.orgId);
  audit(req, 'screen.delete', s.id);
  res.json({ ok: true });
});

/* ================= publish ================= */

router.post('/screens/:id/publish', requireAuth, requirePerm('content:publish'), (req, res) => {
  const s = db.prepare('SELECT * FROM screens WHERE id=? AND org_id=?').get(req.params.id, req.orgId);
  if (!s) return res.status(404).json({ error: 'not_found' });
  if (!branchAllowed(req.user, s.branch_id)) return res.status(403).json({ error: 'branch_not_assigned' });
  const r = publishToScreen(s, { actorId: req.user.id });
  audit(req, 'screen.publish', s.id, { publish_id: r.publish_id });
  res.json({ publish_id: r.publish_id, delivered: r.delivered, payload: r.payload });
});

/** Bulk: assign playlist/ticker to many screens or whole branches, then publish. */
router.post('/publish/bulk', requireAuth, requirePerm('content:publish'), (req, res) => {
  const { screen_ids = [], branch_ids = [], playlist_id, ticker_id, all = false } = req.body || {};
  let screens = db.prepare('SELECT * FROM screens WHERE org_id=?').all(req.orgId);
  if (!all) screens = screens.filter((s) => screen_ids.includes(s.id) || branch_ids.includes(s.branch_id));
  if (req.user.role === 'branch_manager') screens = screens.filter((s) => req.user.branch_ids.includes(s.branch_id));
  if (!screens.length) return res.status(400).json({ error: 'no_target_screens' });

  if (playlist_id && !db.prepare('SELECT 1 FROM playlists WHERE id=? AND org_id=?').get(playlist_id, req.orgId))
    return res.status(400).json({ error: 'playlist_not_found' });

  for (const s of screens) {
    if (playlist_id !== undefined && playlist_id !== null)
      db.prepare('UPDATE screens SET prev_playlist_id=playlist_id, playlist_id=? WHERE id=?').run(playlist_id, s.id);
    if (ticker_id !== undefined) db.prepare('UPDATE screens SET ticker_id=? WHERE id=?').run(ticker_id, s.id);
  }
  const fresh = screens.map((s) => db.prepare('SELECT * FROM screens WHERE id=?').get(s.id));
  const results = publishToScreens(fresh, { actorId: req.user.id });
  audit(req, 'publish.bulk', null, { count: results.length, playlist_id, ticker_id });
  res.json({ targeted: results.length, delivered: results.filter((r) => r.delivered).length, results });
});

/** Rollback a screen to its previous playlist. */
router.post('/screens/:id/rollback', requireAuth, requirePerm('content:publish'), (req, res) => {
  const s = db.prepare('SELECT * FROM screens WHERE id=? AND org_id=?').get(req.params.id, req.orgId);
  if (!s) return res.status(404).json({ error: 'not_found' });
  if (!s.prev_playlist_id) return res.status(400).json({ error: 'no_previous_state' });
  db.prepare('UPDATE screens SET playlist_id=?, prev_playlist_id=? WHERE id=?')
    .run(s.prev_playlist_id, s.playlist_id, s.id);
  const fresh = db.prepare('SELECT * FROM screens WHERE id=?').get(s.id);
  const r = publishToScreen(fresh, { actorId: req.user.id, source: 'rollback' });
  audit(req, 'screen.rollback', s.id, { to: s.prev_playlist_id });
  res.json({ ok: true, publish_id: r.publish_id, delivered: r.delivered, playlist_id: fresh.playlist_id });
});

router.get('/screens/:id/events', requireAuth, (req, res) => {
  const s = db.prepare('SELECT * FROM screens WHERE id=? AND org_id=?').get(req.params.id, req.orgId);
  if (!s) return res.status(404).json({ error: 'not_found' });
  res.json({
    publishes: db.prepare('SELECT * FROM publish_events WHERE screen_id=? ORDER BY created_at DESC LIMIT 20').all(s.id),
    status: db.prepare('SELECT * FROM status_events WHERE screen_id=? ORDER BY created_at DESC LIMIT 20').all(s.id),
    app_version: s.app_version, last_sync_at: s.last_sync_at, last_seen_at: s.last_seen_at,
  });
});

/* ================= device (TV client) HTTP ================= */

router.get('/device/content', requireDevice, (req, res) => {
  db.prepare('UPDATE screens SET last_seen_at=? WHERE id=?').run(now(), req.screen.id);
  res.json(buildPayload(req.screen));
});

router.post('/device/heartbeat', requireDevice, (req, res) => {
  const { app_version, resolution } = req.body || {};
  db.prepare('UPDATE screens SET last_seen_at=?, app_version=?, resolution=? WHERE id=?')
    .run(now(), app_version || req.screen.app_version, resolution || req.screen.resolution, req.screen.id);
  res.json({ ok: true, server_time: now() });
});
