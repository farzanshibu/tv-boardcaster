/* End-to-end verification of the PRD flows against a live server. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { fileURLToPath } from 'node:url';

const __import_dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BUN = process.env.BUN_PATH || 'bun';
const PORT = 4321;
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `bc-test-${Date.now()}.db`);
let proc;

const call = async (p, { method = 'GET', body, token } = {}) => {
  const res = await fetch(`${BASE}/api${p}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test.before(async () => {
  proc = spawn(BUN, ['src/server.js'], {
    env: { ...process.env, PORT: String(PORT), DB_PATH, NODE_ENV: 'e2e', OFFLINE_AFTER_MS: '2000', HEALTH_MS: '1000', DISABLE_RATE_LIMIT: '1', API_ONLY: '1', STORAGE_DRIVER: 'local' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch {}
    await sleep(200);
  }
  throw new Error('server did not start');
});

test.after(() => {
  proc?.kill();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(DB_PATH + s, { force: true });
});

const ctx = {};

test('org onboarding: signup creates tenant, owner and trial', async () => {
  const r = await call('/auth/signup', { method: 'POST', body: {
    name: 'Arjun', email: `owner${Date.now()}@test.com`, password: 'password123', org_name: 'Test Retail' } });
  assert.equal(r.status, 201);
  ctx.owner = r.data.token;
  ctx.email = r.data.user.email;
  const me = await call('/auth/me', { token: ctx.owner });
  assert.equal(me.data.org.plan_tier, 'trial');
  assert.equal(me.data.user.role, 'owner');
  assert.equal(me.data.plan.max_screens, 3);
});

test('login enforces credentials', async () => {
  assert.equal((await call('/auth/login', { method: 'POST', body: { email: ctx.email, password: 'wrong' } })).status, 401);
  assert.equal((await call('/auth/login', { method: 'POST', body: { email: ctx.email, password: 'password123' } })).status, 200);
});

test('branch hierarchy with timezone validation', async () => {
  const bad = await call('/branches', { method: 'POST', token: ctx.owner, body: { name: 'X', timezone: 'Not/AZone' } });
  assert.equal(bad.status, 400);
  const r = await call('/branches', { method: 'POST', token: ctx.owner, body: { name: 'Koramangala', timezone: 'Asia/Kolkata' } });
  assert.equal(r.status, 201);
  ctx.branch = r.data.id;
  const list = await call('/branches', { token: ctx.owner });
  assert.ok(list.data.length >= 2); // default Main Branch + this one
});

test('media library and playlist builder', async () => {
  const m1 = await call('/media/link', { method: 'POST', token: ctx.owner, body: { name: 'Diwali', url: 'https://cdn.test/d.jpg', type: 'image', duration: 6 } });
  const m2 = await call('/media/link', { method: 'POST', token: ctx.owner, body: { name: 'Lunch', url: 'https://cdn.test/l.jpg', type: 'image', duration: 9 } });
  assert.equal(m1.status, 201);
  ctx.media = [m1.data.id, m2.data.id];

  const p = await call('/playlists', { method: 'POST', token: ctx.owner, body: {
    name: 'Brand Loop', items: [{ media_id: ctx.media[0], duration: 6 }, { media_id: ctx.media[1], duration: 9 }] } });
  assert.equal(p.status, 201);
  assert.equal(p.data.total_duration, 15);
  ctx.playlist = p.data.id;

  const p2 = await call('/playlists', { method: 'POST', token: ctx.owner, body: { name: 'Lunch Loop', items: [{ media_id: ctx.media[1], duration: 5 }] } });
  ctx.playlist2 = p2.data.id;

  const bad = await call('/playlists', { method: 'POST', token: ctx.owner, body: { name: 'Bad', items: [{ media_id: 'nope' }] } });
  assert.equal(bad.status, 400);
});

test('flash news ticker', async () => {
  const t = await call('/tickers', { method: 'POST', token: ctx.owner, body: { name: 'Hours', text: 'Open 9-10', position: 'bottom' } });
  assert.equal(t.status, 201);
  ctx.ticker = t.data.id;
  assert.equal((await call('/tickers', { method: 'POST', token: ctx.owner, body: { name: 'X', text: 'y', position: 'middle' } })).status, 400);
});

test('pairing flow: OTP -> verify -> add screen -> live', async () => {
  const otp = await call('/pairing/generate-otp', { method: 'POST', body: {
    device_id: 'dev-e2e-1', metadata: { resolution: '1920x1080', os_type: 'web', orientation: 'landscape' } } });
  assert.equal(otp.status, 201);
  assert.match(otp.data.code, /^\d{4}$/);
  ctx.code = otp.data.code;

  const v = await call('/pairing/verify', { method: 'POST', token: ctx.owner, body: { code: ctx.code } });
  assert.equal(v.data.valid, true);
  assert.equal(v.data.metadata.resolution, '1920x1080');

  const s = await call('/screens', { method: 'POST', token: ctx.owner, body: {
    code: ctx.code, name: 'Front Counter', branch_id: ctx.branch, playlist_id: ctx.playlist, ticker_id: ctx.ticker } });
  assert.equal(s.status, 201);
  assert.equal(s.data.paired, true);
  ctx.screen = s.data.id;

  const status = await call(`/pairing/status/${ctx.code}?device_id=dev-e2e-1`);
  assert.equal(status.data.status, 'paired');
  ctx.deviceToken = status.data.device_token;

  // metadata captured automatically from the TV
  assert.equal(s.data.resolution, '1920x1080');
  // duplicate name in same branch rejected
  const dup = await call('/screens', { method: 'POST', token: ctx.owner, body: { name: 'Front Counter', branch_id: ctx.branch } });
  assert.equal(dup.status, 409);
});

test('expired/invalid codes are rejected', async () => {
  assert.equal((await call('/pairing/verify', { method: 'POST', token: ctx.owner, body: { code: '0000' } })).status, 404);
  assert.equal((await call('/pairing/status/9999?device_id=x')).status, 404);
});

test('device session: connects, receives content, acks, reports plays', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/device/session?token=${ctx.deviceToken}`);
  const messages = [];
  await new Promise((resolve, reject) => {
    ws.on('message', (raw) => { messages.push(JSON.parse(raw)); if (messages.length === 1) resolve(); });
    ws.on('error', reject);
  });
  const first = messages[0];
  assert.equal(first.type, 'content');
  assert.equal(first.payload.playlist.items.length, 2);
  assert.equal(first.payload.ticker.text, 'Open 9-10');
  assert.equal(first.payload.screen.timezone, 'Asia/Kolkata');

  ws.send(JSON.stringify({ type: 'ack', publish_id: first.publish_id }));
  ws.send(JSON.stringify({ type: 'play', media_id: ctx.media[0], playlist_id: ctx.playlist, duration: 6 }));
  ws.send(JSON.stringify({ type: 'heartbeat', app_version: '1.0.0' }));
  await sleep(300);

  const s = await call(`/screens/${ctx.screen}`, { token: ctx.owner });
  assert.equal(s.data.status, 'online');
  assert.ok(s.data.last_sync_at, 'last_sync_at recorded after ack');
  ctx.ws = ws;
});

test('publish latency: dashboard publish reaches TV in under 5s', async () => {
  const got = new Promise((resolve) => ctx.ws.on('message', (raw) => {
    const m = JSON.parse(raw); if (m.type === 'content') resolve(m);
  }));
  const t0 = Date.now();
  const r = await call(`/screens/${ctx.screen}/publish`, { method: 'POST', token: ctx.owner });
  assert.equal(r.data.delivered, true);
  const msg = await got;
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 5000, `publish took ${elapsed}ms`);
  assert.equal(msg.payload.playlist.id, ctx.playlist);
});

test('playlist reassignment pushes new content and supports rollback', async () => {
  await call(`/screens/${ctx.screen}`, { method: 'PATCH', token: ctx.owner, body: { playlist_id: ctx.playlist2 } });
  let s = await call(`/screens/${ctx.screen}`, { token: ctx.owner });
  assert.equal(s.data.playlist_id, ctx.playlist2);

  const rb = await call(`/screens/${ctx.screen}/rollback`, { method: 'POST', token: ctx.owner });
  assert.equal(rb.data.playlist_id, ctx.playlist);
});

test('scheduling engine: dayparting, precedence and timezone awareness', async () => {
  // trial plan lacks scheduling -> 402
  const blocked = await call('/schedules', { method: 'POST', token: ctx.owner, body: {
    name: 'Breakfast', content_id: ctx.playlist2, target_type: 'org', start_time: '00:00', end_time: '23:59' } });
  assert.equal(blocked.status, 402);

  await call('/billing/subscribe', { method: 'POST', token: ctx.owner, body: { plan: 'growth' } });

  const orgWide = await call('/schedules', { method: 'POST', token: ctx.owner, body: {
    name: 'All day org', content_id: ctx.playlist2, target_type: 'org', start_time: '00:00', end_time: '23:59' } });
  assert.equal(orgWide.status, 201);

  let prev = await call(`/schedules/preview/${ctx.screen}`, { token: ctx.owner });
  assert.equal(prev.data.resolved.playlist_id, ctx.playlist2, 'org schedule overrides static assignment');
  assert.equal(prev.data.resolved.source, 'schedule');
  assert.equal(prev.data.timezone, 'Asia/Kolkata');

  // screen-level schedule must beat org-level
  const screenLevel = await call('/schedules', { method: 'POST', token: ctx.owner, body: {
    name: 'Screen specific', content_id: ctx.playlist, target_type: 'screen', target_id: ctx.screen,
    start_time: '00:00', end_time: '23:59' } });
  assert.equal(screenLevel.status, 201);
  assert.ok(screenLevel.data.conflicts.length >= 1, 'overlap surfaced as a warning');

  prev = await call(`/schedules/preview/${ctx.screen}`, { token: ctx.owner });
  assert.equal(prev.data.resolved.playlist_id, ctx.playlist, 'most specific target wins');
  assert.ok(prev.data.resolved.conflicts.length >= 1);

  // out-of-window schedule must not apply
  await call(`/schedules/${screenLevel.data.id}`, { method: 'PATCH', token: ctx.owner, body: { start_time: '03:00', end_time: '03:01' } });
  prev = await call(`/schedules/preview/${ctx.screen}?at=${new Date().toISOString()}`, { token: ctx.owner });
  const local = prev.data.local.time;
  if (local < '03:00' || local > '03:01') assert.equal(prev.data.resolved.playlist_id, ctx.playlist2);
  await call(`/schedules/${screenLevel.data.id}`, { method: 'DELETE', token: ctx.owner });
  await call(`/schedules/${orgWide.data.id}`, { method: 'DELETE', token: ctx.owner });
});

test('RBAC is enforced at the API layer', async () => {
  const inv = await call('/users/invite', { method: 'POST', token: ctx.owner, body: { email: `viewer${Date.now()}@test.com`, role: 'viewer' } });
  assert.equal(inv.status, 201);
  const acc = await call('/users/accept-invite', { method: 'POST', body: { token: inv.data.invite_token, name: 'Neha', password: 'password123' } });
  assert.equal(acc.status, 201);
  const viewer = acc.data.token;

  assert.equal((await call('/screens', { token: viewer })).status, 200, 'viewer can read');
  assert.equal((await call('/playlists', { method: 'POST', token: viewer, body: { name: 'nope' } })).status, 403);
  assert.equal((await call(`/screens/${ctx.screen}/publish`, { method: 'POST', token: viewer })).status, 403);
  assert.equal((await call('/branches', { method: 'POST', token: viewer, body: { name: 'nope' } })).status, 403);
  assert.equal((await call('/billing/subscribe', { method: 'POST', token: viewer, body: { plan: 'growth' } })).status, 403);
  assert.equal((await call('/admin/tenants', { token: viewer })).status, 403);

  const editorInv = await call('/users/invite', { method: 'POST', token: ctx.owner, body: { email: `editor${Date.now()}@test.com`, role: 'content_editor' } });
  const editor = (await call('/users/accept-invite', { method: 'POST', body: { token: editorInv.data.invite_token, name: 'Dev', password: 'password123' } })).data.token;
  assert.equal((await call('/playlists', { method: 'POST', token: editor, body: { name: 'Editor list', items: [] } })).status, 201, 'editor can author');
  assert.equal((await call(`/screens/${ctx.screen}/publish`, { method: 'POST', token: editor })).status, 403, 'editor cannot publish');
});

test('tenant isolation: another org cannot read or touch our data', async () => {
  const other = (await call('/auth/signup', { method: 'POST', body: {
    name: 'Rival', email: `rival${Date.now()}@test.com`, password: 'password123', org_name: 'Rival Retail' } })).data.token;
  const screens = await call('/screens', { token: other });
  assert.equal(screens.data.length, 0);
  assert.equal((await call(`/screens/${ctx.screen}`, { token: other })).status, 404);
  assert.equal((await call(`/screens/${ctx.screen}/publish`, { method: 'POST', token: other })).status, 404);
  assert.equal((await call(`/playlists/${ctx.playlist}`, { token: other })).status, 404);
});

test('bulk publish targets many screens at once', async () => {
  const codes = [];
  for (const name of ['Aisle 3', 'Window']) {
    const otp = await call('/pairing/generate-otp', { method: 'POST', body: { device_id: `dev-${name}` } });
    const s = await call('/screens', { method: 'POST', token: ctx.owner, body: {
      code: otp.data.code, name, branch_id: ctx.branch, playlist_id: ctx.playlist } });
    assert.equal(s.status, 201);
    codes.push(s.data.id);
  }
  const r = await call('/publish/bulk', { method: 'POST', token: ctx.owner, body: { all: true, playlist_id: ctx.playlist2 } });
  assert.equal(r.data.targeted, 3);
  assert.ok(r.data.delivered >= 1, 'connected screen received it instantly');
  const list = await call('/screens', { token: ctx.owner });
  assert.ok(list.data.every((s) => s.playlist_id === ctx.playlist2));
});

test('plan limits block over-provisioning and upgrade lifts them', async () => {
  const trial = (await call('/auth/signup', { method: 'POST', body: {
    name: 'Small', email: `small${Date.now()}@test.com`, password: 'password123', org_name: 'Small Co' } })).data.token;
  const branch = (await call('/branches', { token: trial })).data[0].id;
  for (let i = 0; i < 3; i++) {
    const r = await call('/screens', { method: 'POST', token: trial, body: { name: `S${i}`, branch_id: branch } });
    assert.equal(r.status, 201);
  }
  const over = await call('/screens', { method: 'POST', token: trial, body: { name: 'S4', branch_id: branch } });
  assert.equal(over.status, 402);
  assert.equal(over.data.error, 'screen_limit_reached');

  const up = await call('/billing/subscribe', { method: 'POST', token: trial, body: { plan: 'growth', billing_cycle: 'monthly' } });
  assert.equal(up.status, 200);
  assert.equal((await call('/screens', { method: 'POST', token: trial, body: { name: 'S4', branch_id: branch } })).status, 201);
});

test('billing produces a GST-compliant invoice', async () => {
  const b = await call('/billing', { token: ctx.owner });
  assert.equal(b.data.subscription.plan, 'growth');
  assert.ok(b.data.invoices.length >= 1);
  const inv = await call(`/billing/invoices/${b.data.invoices[0].id}`, { token: ctx.owner });
  assert.equal(inv.data.tax_label, 'GST 18%');
  assert.equal(inv.data.total, inv.data.subtotal + inv.data.tax);
  assert.ok(inv.data.issuer.gstin);
  assert.match(inv.data.number, /^BC-\d{4}-/);
});

test('unpair revokes the device token and forces re-pairing', async () => {
  const otp = await call('/pairing/generate-otp', { method: 'POST', body: { device_id: 'dev-unpair' } });
  const s = await call('/screens', { method: 'POST', token: ctx.owner, body: { code: otp.data.code, name: 'Temp Screen', branch_id: ctx.branch } });
  const token = (await call(`/pairing/status/${otp.data.code}?device_id=${otp.data.device_id}`)).data.device_token;
  assert.equal((await fetch(`${BASE}/api/device/content`, { headers: { authorization: `Bearer ${token}` } })).status, 200);

  await call(`/screens/${s.data.id}/unpair`, { method: 'POST', token: ctx.owner });
  assert.equal((await fetch(`${BASE}/api/device/content`, { headers: { authorization: `Bearer ${token}` } })).status, 401);
  const wsRes = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/device/session?token=${token}`);
    ws.on('error', () => resolve('rejected'));
    ws.on('open', () => { ws.close(); resolve('accepted'); });
  });
  assert.equal(wsRes, 'rejected');
});

test('offline detection flips status and raises an alert', async () => {
  ctx.ws.close();
  await sleep(3500); // OFFLINE_AFTER_MS=2000 + health tick
  const s = await call(`/screens/${ctx.screen}`, { token: ctx.owner });
  assert.equal(s.data.status, 'offline');
  const n = await call('/notifications', { token: ctx.owner });
  assert.ok(n.data.some((x) => x.kind === 'screen_offline'));
});

test('offline recovery: TV reconnects and pulls missed updates', async () => {
  await call(`/screens/${ctx.screen}`, { method: 'PATCH', token: ctx.owner, body: { playlist_id: ctx.playlist } });
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/device/session?token=${ctx.deviceToken}`);
  const msg = await new Promise((resolve, reject) => {
    ws.on('message', (raw) => resolve(JSON.parse(raw)));
    ws.on('error', reject);
  });
  assert.equal(msg.type, 'content');
  assert.equal(msg.payload.playlist.id, ctx.playlist, 'missed update delivered on reconnect');
  await sleep(200);
  const s = await call(`/screens/${ctx.screen}`, { token: ctx.owner });
  assert.equal(s.data.status, 'online');
  ws.close();
});

test('analytics report uptime and content performance', async () => {
  const up = await call('/analytics/uptime', { token: ctx.owner });
  assert.ok(up.data.screens.length >= 3);
  assert.ok(typeof up.data.fleet_uptime_pct === 'number');
  const c = await call('/analytics/content', { token: ctx.owner });
  assert.ok(c.data.by_media.some((m) => m.media_id === ctx.media[0]), 'play events recorded');
  const o = await call('/analytics/overview', { token: ctx.owner });
  assert.ok(o.data.total_screens >= 3);
});

test('audit log records admin and publish actions', async () => {
  const a = await call('/audit-logs', { token: ctx.owner });
  const actions = a.data.map((x) => x.action);
  for (const expected of ['screen.create', 'screen.publish', 'branch.create', 'billing.subscribe', 'user.invite'])
    assert.ok(actions.includes(expected), `missing audit action ${expected}`);
});

test('superadmin console: tenants, flags, impersonation, health', async () => {
  // provision a platform superadmin directly in the test database
  const mk = spawn(process.execPath, ['--input-type=module', '-e', `
    const { db, migrate, uid, now } = await import(${JSON.stringify('file://' + __import_dir + '/src/lib/db.js')});
    const { hash } = await import(${JSON.stringify('file://' + __import_dir + '/src/lib/auth.js')});
    migrate();
    db.prepare('INSERT INTO users (id,org_id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(uid('usr'), null, 'Ops', 'root@brandcast.tv', hash('superadmin123'), 'superadmin', now());
  `], { env: { ...process.env, DB_PATH }, stdio: 'ignore' });
  await new Promise((r) => mk.on('exit', r));

  const login = await call('/auth/login', { method: 'POST', body: { email: 'root@brandcast.tv', password: 'superadmin123' } });
  assert.equal(login.status, 200);
  const root = login.data.token;

  const tenants = await call('/admin/tenants', { token: root });
  assert.ok(tenants.data.length >= 3);
  assert.ok(tenants.data.every((t) => 'revenue_mrr' in t));

  const target = tenants.data.find((t) => t.name === 'Test Retail');
  const flags = await call(`/admin/tenants/${target.id}/flags`, { method: 'POST', token: root, body: { flags: { sso: true } } });
  assert.equal(flags.data.feature_flags.sso, true);

  const imp = await call(`/admin/tenants/${target.id}/impersonate`, { method: 'POST', token: root, body: { reason: 'support ticket 42' } });
  const asTenant = await call('/auth/me', { token: imp.data.token });
  assert.equal(asTenant.data.org.id, target.id);
  assert.equal(asTenant.data.impersonating, true);

  const health = await call('/admin/health', { token: root });
  assert.ok(health.data.organizations >= 3);
  assert.ok(health.data.screens >= 3);

  // suspension blocks tenant access
  await call(`/admin/tenants/${target.id}/suspend`, { method: 'POST', token: root });
  assert.equal((await call('/screens', { token: ctx.owner })).status, 403);
  await call(`/admin/tenants/${target.id}/suspend`, { method: 'POST', token: root });
  assert.equal((await call('/screens', { token: ctx.owner })).status, 200);
});

test('2FA enrollment gates subsequent logins', async () => {
  const setup = await call('/auth/2fa/setup', { method: 'POST', token: ctx.owner });
  assert.ok(setup.data.secret);
  const noCode = await call('/auth/login', { method: 'POST', body: { email: ctx.email, password: 'password123' } });
  assert.equal(noCode.data.error, 'totp_required');

  const { totpCode } = await import('../src/lib/auth.js');
  const ok = await call('/auth/login', { method: 'POST', body: { email: ctx.email, password: 'password123', totp: totpCode(setup.data.secret) } });
  assert.equal(ok.status, 200);
});

test('the API server returns 503 for UI routes when Next is not attached', async () => {
  // API_ONLY mode runs the data plane alone; the Next handler is attached by
  // server.js at the repo root. A clear 503 beats a confusing 404.
  const res = await fetch(`${BASE}/dashboard`);
  assert.equal(res.status, 503);
  assert.match(await res.text(), /UI not attached/);
});

test('storage reports its active driver', async () => {
  const health = await call('/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.storage, 'local', 'tests run on the local driver');
});
