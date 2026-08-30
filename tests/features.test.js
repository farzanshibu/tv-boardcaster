/* Coverage for features claimed complete but not exercised by e2e.test.js:
   uploads, version history, approval workflow, branch-manager scoping, branch
   defaults, SSO, password reset, billing cancel and the device HTTP endpoints. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/postgres.js';

const PORT = 4323;
const BASE = `http://127.0.0.1:${PORT}`;
let server;

const call = async (p, { method = 'GET', body, token, form } = {}) => {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(`${BASE}/api${p}`, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// a real 1x1 PNG
const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080600000' +
  '01f15c4890000000d49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082', 'hex');

const upload = (bytes, filename, type, extra = {}) => {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type }), filename);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return fd;
};

// Booted at module load: node:test caps a before hook at 5s, and starting a real
// server against a fresh database is legitimately slower than that.
server = await startServer({
  label: 'feat',
  port: PORT,
  env: { DISABLE_RATE_LIMIT: '1' },
});

test.after(async () => {
  await server?.stop();
});

const ctx = {};

test('setup: org with an owner', async () => {
  const r = await call('/auth/signup', { method: 'POST', body: {
    name: 'Owner', email: `feat${Date.now()}@test.com`, password: 'password123', org_name: 'Feature Co' } });
  ctx.owner = r.data.token;
  ctx.email = r.data.user.email;
  ctx.branchA = (await call('/branches', { token: ctx.owner })).data[0].id;
  const b = await call('/branches', { method: 'POST', token: ctx.owner, body: { name: 'Branch B', timezone: 'Asia/Dubai' } });
  ctx.branchB = b.data.id;
  // move off the 3-screen trial cap so screen creation is never the limiting factor
  assert.equal((await call('/billing/subscribe', { method: 'POST', token: ctx.owner, body: { plan: 'growth' } })).status, 200);
});

/* ---------- real multipart uploads ---------- */

test('media upload accepts a real file and rejects bad types/oversize', async () => {
  const r = await call('/media', { method: 'POST', token: ctx.owner,
    form: upload(PNG, 'promo.png', 'image/png', { name: 'Promo Banner', duration: '12' }) });
  assert.equal(r.status, 201);
  assert.equal(r.data.type, 'image');
  assert.equal(r.data.duration, 12);
  assert.equal(r.data.version, 1);
  assert.ok(r.data.bytes > 0);
  ctx.uploaded = r.data;

  // the file is actually served
  const served = await fetch(BASE + r.data.url);
  assert.equal(served.status, 200);
  assert.equal(Buffer.from(await served.arrayBuffer()).length, PNG.length);

  const bad = await call('/media', { method: 'POST', token: ctx.owner,
    form: upload(Buffer.from('#!/bin/sh'), 'evil.sh', 'application/x-sh') });
  assert.equal(bad.status, 415, 'unsupported mime type rejected');
});

test('version history: replace, list and restore', async () => {
  const id = ctx.uploaded.id;
  const v1url = ctx.uploaded.url;

  const rep = await call(`/media/${id}/replace`, { method: 'POST', token: ctx.owner,
    form: upload(Buffer.concat([PNG, PNG]), 'promo-v2.png', 'image/png') });
  assert.equal(rep.status, 200);
  assert.equal(rep.data.version, 2);
  assert.notEqual(rep.data.url, v1url);

  const versions = await call(`/media/${id}/versions`, { token: ctx.owner });
  assert.equal(versions.data.length, 2);

  const restored = await call(`/media/${id}/restore/1`, { method: 'POST', token: ctx.owner });
  assert.equal(restored.data.version, 3, 'restore creates a new version');
  assert.equal(restored.data.url, v1url, 'content reverted to v1');
  assert.equal((await fetch(BASE + restored.data.url)).status, 200);
});

test('media in use cannot be deleted', async () => {
  const pl = await call('/playlists', { method: 'POST', token: ctx.owner, body: {
    name: 'Uses Upload', items: [{ media_id: ctx.uploaded.id, duration: 5 }] } });
  ctx.playlistA = pl.data.id;
  const del = await call(`/media/${ctx.uploaded.id}`, { method: 'DELETE', token: ctx.owner });
  assert.equal(del.status, 409);
  assert.equal(del.data.error, 'media_in_use');
});

/* ---------- approval workflow ---------- */

test('approval workflow gates content until an approver signs off', async () => {
  await call('/org', { method: 'PATCH', token: ctx.owner, body: { approval_required: true } });

  const m = await call('/media/link', { method: 'POST', token: ctx.owner, body: {
    name: 'Needs approval', url: 'https://cdn.test/a.jpg', type: 'image' } });
  assert.equal(m.data.status, 'pending', 'new media is pending when approval is required');

  const pl = await call('/playlists', { method: 'POST', token: ctx.owner, body: {
    name: 'Pending list', items: [{ media_id: m.data.id, duration: 5 }] } });
  assert.equal(pl.data.status, 'pending');

  // pair a screen and point it at the unapproved playlist
  const otp = await call('/pairing/generate-otp', { method: 'POST', body: { device_id: 'appr-dev' } });
  const scr = await call('/screens', { method: 'POST', token: ctx.owner, body: {
    code: otp.data.code, name: 'Approval Screen', branch_id: ctx.branchA, playlist_id: pl.data.id } });
  assert.equal(scr.status, 201);
  ctx.apprScreen = scr.data.id;
  ctx.apprToken = (await call(`/pairing/status/${otp.data.code}?device_id=${otp.data.device_id}`)).data.device_token;

  let payload = await (await fetch(`${BASE}/api/device/content`, { headers: { authorization: `Bearer ${ctx.apprToken}` } })).json();
  assert.equal(payload.playlist, null, 'unapproved playlist is not delivered to the TV');

  await call(`/playlists/${pl.data.id}/approve`, { method: 'POST', token: ctx.owner });
  payload = await (await fetch(`${BASE}/api/device/content`, { headers: { authorization: `Bearer ${ctx.apprToken}` } })).json();
  assert.ok(payload.playlist, 'approved playlist is delivered');
  assert.equal(payload.playlist.items.length, 0, 'but its unapproved media is still filtered out');

  await call(`/media/${m.data.id}/approve`, { method: 'POST', token: ctx.owner });
  payload = await (await fetch(`${BASE}/api/device/content`, { headers: { authorization: `Bearer ${ctx.apprToken}` } })).json();
  assert.equal(payload.playlist.items.length, 1, 'fully approved content reaches the screen');

  await call('/org', { method: 'PATCH', token: ctx.owner, body: { approval_required: false } });
  const after = await call('/media/link', { method: 'POST', token: ctx.owner, body: {
    name: 'Auto ok', url: 'https://cdn.test/b.jpg', type: 'image' } });
  assert.equal(after.data.status, 'approved', 'approval off means content publishes directly');
});

test('content_editor cannot approve its own content', async () => {
  const inv = await call('/users/invite', { method: 'POST', token: ctx.owner, body: { email: `ed${Date.now()}@t.com`, role: 'content_editor' } });
  const editor = (await call('/users/accept-invite', { method: 'POST', body: {
    token: inv.data.invite_token, name: 'Ed', password: 'password123' } })).data.token;
  const m = await call('/media/link', { method: 'POST', token: editor, body: { name: 'x', url: 'https://c/x.jpg', type: 'image' } });
  assert.equal((await call(`/media/${m.data.id}/approve`, { method: 'POST', token: editor })).status, 403);
});

/* ---------- branch manager scoping ---------- */

test('branch manager is confined to assigned branches', async () => {
  const inv = await call('/users/invite', { method: 'POST', token: ctx.owner, body: {
    email: `bm${Date.now()}@t.com`, role: 'branch_manager', branch_ids: [ctx.branchA] } });
  const bm = (await call('/users/accept-invite', { method: 'POST', body: {
    token: inv.data.invite_token, name: 'Riya', password: 'password123' } })).data.token;
  ctx.bm = bm;

  // screens in branch B exist but must not be visible
  const otp = await call('/pairing/generate-otp', { method: 'POST', body: { device_id: 'bdev' } });
  const inB = await call('/screens', { method: 'POST', token: ctx.owner, body: {
    code: otp.data.code, name: 'B Screen', branch_id: ctx.branchB } });
  assert.equal(inB.status, 201);

  const visibleScreens = await call('/screens', { token: bm });
  assert.ok(visibleScreens.data.every((s) => s.branch_id === ctx.branchA), 'only assigned branch screens listed');
  assert.ok(!visibleScreens.data.some((s) => s.id === inB.data.id));

  const visibleBranches = await call('/branches', { token: bm });
  assert.equal(visibleBranches.data.length, 1);
  assert.equal(visibleBranches.data[0].id, ctx.branchA);

  // cannot create or modify screens in an unassigned branch
  const otp2 = await call('/pairing/generate-otp', { method: 'POST', body: { device_id: 'bdev2' } });
  const denied = await call('/screens', { method: 'POST', token: bm, body: {
    code: otp2.data.code, name: 'Sneaky', branch_id: ctx.branchB } });
  assert.equal(denied.status, 403);
  assert.equal((await call(`/screens/${inB.data.id}`, { method: 'PATCH', token: bm, body: { name: 'hijack' } })).status, 403);
  assert.equal((await call(`/screens/${inB.data.id}/publish`, { method: 'POST', token: bm })).status, 403);

  // bulk publish must not leak into other branches
  const bulk = await call('/publish/bulk', { method: 'POST', token: bm, body: { all: true, playlist_id: ctx.playlistA } });
  assert.ok(bulk.data.results.every((r) => r.screen_id !== inB.data.id), 'bulk scoped to assigned branches');
  const bScreen = (await call(`/screens/${inB.data.id}`, { token: ctx.owner })).data;
  assert.notEqual(bScreen.playlist_id, ctx.playlistA, 'branch B screen untouched');

  // branch managers cannot manage branches or users
  assert.equal((await call('/branches', { method: 'POST', token: bm, body: { name: 'New' } })).status, 403);
  assert.equal((await call('/users/invite', { method: 'POST', token: bm, body: { email: 'x@y.com', role: 'viewer' } })).status, 403);
});

/* ---------- branch defaults ---------- */

test('branch default playlist applies to screens with no assignment', async () => {
  const m = await call('/media/link', { method: 'POST', token: ctx.owner, body: { name: 'Branch default', url: 'https://cdn.test/bd.jpg', type: 'image' } });
  const pl = await call('/playlists', { method: 'POST', token: ctx.owner, body: {
    name: 'Branch B Default', items: [{ media_id: m.data.id, duration: 7 }] } });
  const tk = await call('/tickers', { method: 'POST', token: ctx.owner, body: { name: 'B ticker', text: 'Dubai hours' } });
  await call(`/branches/${ctx.branchB}`, { method: 'PATCH', token: ctx.owner, body: {
    default_playlist_id: pl.data.id, default_ticker_id: tk.data.id } });

  const otp = await call('/pairing/generate-otp', { method: 'POST', body: { device_id: 'default-dev' } });
  const scr = await call('/screens', { method: 'POST', token: ctx.owner, body: {
    code: otp.data.code, name: 'No Playlist Screen', branch_id: ctx.branchB } });
  assert.equal(scr.status, 201);
  assert.equal(scr.data.playlist_id, null, 'screen itself has no playlist');

  const token = (await call(`/pairing/status/${otp.data.code}?device_id=${otp.data.device_id}`)).data.device_token;
  const payload = await (await fetch(`${BASE}/api/device/content`, { headers: { authorization: `Bearer ${token}` } })).json();
  assert.equal(payload.playlist.id, pl.data.id, 'branch default used as fallback');
  assert.equal(payload.ticker.id, tk.data.id);
  assert.equal(payload.screen.timezone, 'Asia/Dubai');
});

test('ticker time-boxing hides it outside the configured window', async () => {
  const tk = await call('/tickers', { method: 'POST', token: ctx.owner, body: {
    name: 'Boxed', text: 'Only at 3am', start_time: '03:00', end_time: '03:01' } });
  const otp = await call('/pairing/generate-otp', { method: 'POST', body: { device_id: 'tk-dev' } });
  const scr = await call('/screens', { method: 'POST', token: ctx.owner, body: {
    code: otp.data.code, name: 'Ticker Screen', branch_id: ctx.branchA, ticker_id: tk.data.id } });
  assert.equal(scr.status, 201);
  const token = (await call(`/pairing/status/${otp.data.code}?device_id=${otp.data.device_id}`)).data.device_token;
  const payload = await (await fetch(`${BASE}/api/device/content`, { headers: { authorization: `Bearer ${token}` } })).json();

  const local = (await call(`/schedules/preview/${scr.data.id}`, { token: ctx.owner })).data.local.time;
  if (local >= '03:00' && local <= '03:01') assert.ok(payload.ticker, 'inside window the ticker shows');
  else assert.equal(payload.ticker, null, 'outside window the ticker is withheld');
});

/* ---------- device HTTP endpoints ---------- */

test('device heartbeat records app version and resolution', async () => {
  const r = await call('/device/heartbeat', { method: 'POST', token: ctx.apprToken, body: {
    app_version: '2.3.1', resolution: '3840x2160' } });
  assert.equal(r.status, 200);
  assert.ok(r.data.server_time);
  const s = (await call(`/screens/${ctx.apprScreen}`, { token: ctx.owner })).data;
  assert.equal(s.app_version, '2.3.1');
  assert.equal(s.resolution, '3840x2160');
  assert.ok(s.last_seen_at);

  assert.equal((await call('/device/heartbeat', { method: 'POST', token: 'garbage' })).status, 401);
  assert.equal((await call('/device/content', { token: ctx.owner })).status, 401, 'user token is not a device token');
});

/* ---------- password reset ---------- */

test('password reset issues a single-use token and rotates the password', async () => {
  const f = await call('/auth/forgot-password', { method: 'POST', body: { email: ctx.email } });
  assert.equal(f.status, 200);
  const rt = f.data.reset_token;
  assert.ok(rt);

  assert.equal((await call('/auth/reset-password', { method: 'POST', body: { token: rt, password: 'short' } })).status, 400);
  assert.equal((await call('/auth/reset-password', { method: 'POST', body: { token: rt, password: 'newpassword456' } })).status, 200);
  assert.equal((await call('/auth/login', { method: 'POST', body: { email: ctx.email, password: 'password123' } })).status, 401, 'old password dead');
  const relog = await call('/auth/login', { method: 'POST', body: { email: ctx.email, password: 'newpassword456' } });
  assert.equal(relog.status, 200);
  ctx.owner = relog.data.token;

  assert.equal((await call('/auth/reset-password', { method: 'POST', body: { token: rt, password: 'again12345' } })).status, 400, 'token is single use');
  assert.equal((await call('/auth/forgot-password', { method: 'POST', body: { email: 'nobody@nowhere.com' } })).status, 200, 'no account enumeration');
});

/* ---------- SSO ---------- */

test('SSO is gated by plan and only for provisioned users', async () => {
  const blocked = await call('/auth/sso', { method: 'POST', body: { email: ctx.email } });
  assert.equal(blocked.status, 402, 'growth plan has no SSO');

  await call('/billing/subscribe', { method: 'POST', token: ctx.owner, body: { plan: 'enterprise' } });
  const ok = await call('/auth/sso', { method: 'POST', body: { email: ctx.email, provider: 'google' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.provider, 'google');
  assert.equal((await call('/auth/me', { token: ok.data.token })).status, 200, 'SSO token is usable');

  assert.equal((await call('/auth/sso', { method: 'POST', body: { email: 'ghost@nowhere.com' } })).status, 401);
});

/* ---------- billing lifecycle ---------- */

test('downgrade is blocked when screen count exceeds the target plan', async () => {
  const before = (await call('/billing', { token: ctx.owner })).data;
  assert.ok(before.usage.screens > 3, 'org has more screens than the trial allows');
  const down = await call('/billing/subscribe', { method: 'POST', token: ctx.owner, body: { plan: 'trial' } });
  assert.equal(down.status, 400);
  assert.equal(down.data.error, 'downgrade_blocked_screen_count');
});

test('cancel marks the subscription canceled', async () => {
  assert.equal((await call('/billing/cancel', { method: 'POST', token: ctx.owner })).status, 200);
  const b = await call('/billing', { token: ctx.owner });
  assert.equal(b.data.subscription.status, 'canceled');
});

test('yearly billing applies the discount and invoices correctly', async () => {
  const r = await call('/billing/subscribe', { method: 'POST', token: ctx.owner, body: {
    plan: 'growth', billing_cycle: 'yearly', gateway: 'stripe' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.subscription.billing_cycle, 'yearly');
  assert.match(r.data.subscription.payment_method, /^stripe:/);
  const monthly = 399 * r.data.invoice.screens;
  assert.ok(r.data.invoice.subtotal > monthly, 'yearly bills more than one month');
  assert.ok(r.data.invoice.subtotal < monthly * 12, '15% annual discount applied');
  assert.equal(r.data.invoice.total, r.data.invoice.subtotal + r.data.invoice.tax);
});

test('unknown plans and cycles are rejected', async () => {
  assert.equal((await call('/billing/subscribe', { method: 'POST', token: ctx.owner, body: { plan: 'platinum' } })).status, 400);
  assert.equal((await call('/billing/subscribe', { method: 'POST', token: ctx.owner, body: { plan: 'growth', billing_cycle: 'daily' } })).status, 400);
});

/* ---------- notifications ---------- */

test('notifications can be listed and marked read', async () => {
  const before = await call('/notifications', { token: ctx.owner });
  assert.ok(before.data.length > 0, 'billing events generated notifications');
  await call('/notifications/read', { method: 'POST', token: ctx.owner });
  const after = await call('/notifications', { token: ctx.owner });
  assert.ok(after.data.every((n) => n.read === 1));
});

/* ---------- user lifecycle ---------- */

test('disabled users lose access immediately', async () => {
  const inv = await call('/users/invite', { method: 'POST', token: ctx.owner, body: { email: `tmp${Date.now()}@t.com`, role: 'viewer' } });
  const acc = await call('/users/accept-invite', { method: 'POST', body: {
    token: inv.data.invite_token, name: 'Temp', password: 'password123' } });
  const tok = acc.data.token;
  assert.equal((await call('/screens', { token: tok })).status, 200);

  await call(`/users/${acc.data.user.id}`, { method: 'DELETE', token: ctx.owner });
  assert.equal((await call('/screens', { token: tok })).status, 401, 'disabled user token rejected');

  const users = await call('/users', { token: ctx.owner });
  assert.ok(!users.data.some((u) => u.id === acc.data.user.id && u.status === 'active'));
});

test('the owner account is protected', async () => {
  const users = await call('/users', { token: ctx.owner });
  const owner = users.data.find((u) => u.role === 'owner');
  assert.equal((await call(`/users/${owner.id}`, { method: 'DELETE', token: ctx.owner })).status, 403);
  const inv = await call('/users/invite', { method: 'POST', token: ctx.owner, body: { email: `adm${Date.now()}@t.com`, role: 'admin' } });
  const admin = (await call('/users/accept-invite', { method: 'POST', body: {
    token: inv.data.invite_token, name: 'Adm', password: 'password123' } })).data.token;
  assert.equal((await call(`/users/${owner.id}`, { method: 'PATCH', token: admin, body: { role: 'viewer' } })).status, 403,
    'an admin cannot demote the owner');
  assert.equal((await call('/users/invite', { method: 'POST', token: ctx.owner, body: { email: 'x@y.com', role: 'superadmin' } })).status, 400,
    'superadmin cannot be granted from a tenant');
});

test('invites are single-use and reject duplicate emails', async () => {
  const inv = await call('/users/invite', { method: 'POST', token: ctx.owner, body: { email: `once${Date.now()}@t.com`, role: 'viewer' } });
  assert.equal((await call('/users/accept-invite', { method: 'POST', body: {
    token: inv.data.invite_token, name: 'A', password: 'password123' } })).status, 201);
  assert.equal((await call('/users/accept-invite', { method: 'POST', body: {
    token: inv.data.invite_token, name: 'B', password: 'password123' } })).status, 400, 'invite already used');
});

/* ---------- branch archive ---------- */

test('archiving a branch keeps it out of the active count', async () => {
  const b = await call('/branches', { method: 'POST', token: ctx.owner, body: { name: 'Temp Branch' } });
  const beforeOverview = (await call('/analytics/overview', { token: ctx.owner })).data.branches;
  await call(`/branches/${b.data.id}`, { method: 'DELETE', token: ctx.owner });
  const after = (await call('/branches', { token: ctx.owner })).data.find((x) => x.id === b.data.id);
  assert.equal(after.status, 'archived');
  assert.equal((await call('/analytics/overview', { token: ctx.owner })).data.branches, beforeOverview - 1);
});
