/* UI smoke test: runs the real dashboard modules in jsdom against a live server,
   verifying login, navigation, and that each view renders real data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const realFetch = globalThis.fetch.bind(globalThis);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4322;
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `bc-ui-${Date.now()}.db`);
let proc, dom, token;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test.before(async () => {
  // seed a demo tenant into a throwaway DB
  const seed = spawn(process.execPath, ['scripts/seed.js'], { cwd: ROOT, env: { ...process.env, DB_PATH }, stdio: 'ignore' });
  await new Promise((r) => seed.on('exit', r));

  proc = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT), DB_PATH, DISABLE_RATE_LIMIT: '1' }, stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {}
    await sleep(200);
  }
  token = (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@acme.test', password: 'password123' }),
  })).json()).token;
  assert.ok(token, 'seeded owner can log in');
});

test.after(() => {
  proc?.kill();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(DB_PATH + s, { force: true });
});

/** Boot the real dashboard bundle in jsdom with a logged-in session. */
async function boot(hash = '#/dashboard') {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  dom = new JSDOM(html, { url: `${BASE}/${hash}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.localStorage.setItem('bc_token', token);
  // route relative fetches to the live server
  w.fetch = (url, opts) => realFetch(String(url).startsWith('http') ? String(url) : BASE + url, opts);
  w.WebSocket = class { constructor() { this.readyState = 0; } close() {} send() {} addEventListener() {} };
  w.confirm = () => true;
  w.alert = () => {};

  const g = globalThis;
  const saved = { window: g.window, document: g.document, location: g.location, localStorage: g.localStorage, fetch: g.fetch, WebSocket: g.WebSocket, Node: g.Node, FormData: g.FormData, Blob: g.Blob, MutationObserver: g.MutationObserver, navigator: g.navigator };
  Object.assign(g, {
    window: w, document: w.document, localStorage: w.localStorage,
    fetch: w.fetch, WebSocket: w.WebSocket, Node: w.Node, FormData: w.FormData,
    Blob: w.Blob, MutationObserver: w.MutationObserver,
  });
  Object.defineProperty(g, 'location', { value: w.location, configurable: true, writable: true });
  Object.defineProperty(g, 'navigator', { value: w.navigator, configurable: true, writable: true });

  // NOTE: no cache-busting, so the views share the single core.js module instance
  const core = await import(pathToFileURL(path.join(ROOT, 'public/dashboard/core.js')).href);
  const vcore = await import(pathToFileURL(path.join(ROOT, 'public/dashboard/views-core.js')).href);
  const vcontent = await import(pathToFileURL(path.join(ROOT, 'public/dashboard/views-content.js')).href);
  const vops = await import(pathToFileURL(path.join(ROOT, 'public/dashboard/views-ops.js')).href);
  core.state.token = token;
  core.state.me = await core.api('/auth/me');
  return { w, core, views: { ...vcore, ...vcontent, ...vops }, restore: () => Object.assign(g, saved) };
}

const render = async (view, ctx) => {
  const node = await view(() => {});
  ctx.w.document.body.appendChild(node);
  return node.textContent;
};

test('login screen renders the signup/sign-in form', async () => {
  const ctx = await boot();
  ctx.core.state.token = null; ctx.core.state.me = null;
  const node = ctx.views.LoginView();
  const text = node.textContent;
  assert.match(text, /Brandcast TV/);
  assert.match(text, /Sign in/);
  assert.equal(node.querySelectorAll('input').length, 2);
  ctx.restore();
});

test('overview renders live stats from the seeded org', async () => {
  const ctx = await boot();
  const text = await render(ctx.views.DashboardView, ctx);
  assert.match(text, /Total screens/);
  assert.match(text, /Online now/);
  assert.match(text, /Screen health/);
  assert.match(text, /Front Counter Display/, 'seeded screen appears');
  ctx.restore();
});

test('screens view lists screens and exposes Add New Screen', async () => {
  const ctx = await boot();
  const node = await ctx.views.ScreensView(() => {});
  ctx.w.document.body.appendChild(node);
  assert.match(node.textContent, /Add New Screen/);
  assert.match(node.textContent, /Front Counter Display/);
  assert.match(node.textContent, /Koramangala Store/);

  // open the pairing modal and confirm every PRD field is present
  const addBtn = [...node.querySelectorAll('button')].find((b) => b.textContent.includes('Add New Screen'));
  addBtn.dispatchEvent(new ctx.w.Event('click'));
  const modal = ctx.w.document.querySelector('.modal');
  assert.ok(modal, 'Add New Screen modal opens');
  const labels = [...modal.querySelectorAll('label')].map((l) => l.textContent);
  for (const f of ['Pairing code from TV', 'Screen name', 'Branch', 'Playlist', 'Flash news', 'Orientation'])
    assert.ok(labels.includes(f), `modal has "${f}" field`);
  ctx.restore();
});

test('pairing through the UI takes a screen live', async () => {
  const ctx = await boot();
  const otp = await (await fetch(`${BASE}/api/pairing/generate-otp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_id: 'ui-dev', metadata: { resolution: '3840x2160', os_type: 'tizen' } }),
  })).json();

  const node = await ctx.views.ScreensView(() => {});
  ctx.w.document.body.appendChild(node);
  [...node.querySelectorAll('button')].find((b) => b.textContent.includes('Add New Screen'))
    .dispatchEvent(new ctx.w.Event('click'));

  const modal = ctx.w.document.querySelector('.modal');
  const inputs = modal.querySelectorAll('input');
  inputs[0].value = otp.code;              // pairing code
  inputs[1].value = 'UI Paired Screen';    // name
  [...modal.querySelectorAll('button')].find((b) => b.textContent.includes('Pair & go live'))
    .dispatchEvent(new ctx.w.Event('click'));
  await sleep(600);

  const screens = await (await fetch(`${BASE}/api/screens`, { headers: { authorization: `Bearer ${token}` } })).json();
  const created = screens.find((s) => s.name === 'UI Paired Screen');
  assert.ok(created, 'screen created through the UI');
  assert.equal(created.resolution, '3840x2160', 'TV metadata captured automatically');
  assert.equal(created.os_type, 'tizen');
  ctx.restore();
});

test('media, playlists and tickers views render seeded content', async () => {
  const ctx = await boot();
  assert.match(await render(ctx.views.MediaView, ctx), /Diwali Mega Sale/);
  assert.match(await render(ctx.views.PlaylistsView, ctx), /Always-On Brand Loop/);
  assert.match(await render(ctx.views.TickersView, ctx), /Store Hours & Offers/);
  ctx.restore();
});

test('branches view shows hierarchy with local times', async () => {
  const ctx = await boot();
  const text = await render(ctx.views.BranchesView, ctx);
  assert.match(text, /Koramangala Store/);
  assert.match(text, /Dubai Mall Kiosk/);
  assert.match(text, /Asia\/Dubai/);
  ctx.restore();
});

test('scheduling view lists dayparts', async () => {
  const ctx = await boot();
  const text = await render(ctx.views.SchedulesView, ctx);
  assert.match(text, /Breakfast Daypart/);
  assert.match(text, /Lunch Daypart/);
  assert.match(text, /07:00/);
  ctx.restore();
});

test('analytics view renders uptime and performance panels', async () => {
  const ctx = await boot();
  const text = await render(ctx.views.AnalyticsView, ctx);
  assert.match(text, /Fleet uptime/);
  assert.match(text, /Screen uptime/);
  assert.match(text, /Top media by plays/);
  ctx.restore();
});

test('team view lists all roles', async () => {
  const ctx = await boot();
  const text = await render(ctx.views.TeamView, ctx);
  for (const name of ['Arjun Mehta', 'Priya Nair', 'Riya Sharma'])
    assert.match(text, new RegExp(name));
  ctx.restore();
});

test('billing view shows plans, usage and invoices', async () => {
  const ctx = await boot();
  const text = await render(ctx.views.BillingView, ctx);
  assert.match(text, /Current plan/);
  assert.match(text, /Growth/);
  assert.match(text, /Enterprise/);
  assert.match(text, /Invoices/);
  ctx.restore();
});

test('settings view exposes org controls and 2FA', async () => {
  const ctx = await boot();
  const text = await render(ctx.views.SettingsView, ctx);
  assert.match(text, /Require 2FA/);
  assert.match(text, /approval/i);
  assert.match(text, /Open TV player/);
  ctx.restore();
});

test('viewer role hides write actions in the UI', async () => {
  const ctx = await boot();
  const viewerToken = (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'viewer@acme.test', password: 'password123' }),
  })).json()).token;
  ctx.core.state.token = viewerToken;
  ctx.core.state.me = await ctx.core.api('/auth/me');

  const screens = await ctx.views.ScreensView(() => {});
  assert.doesNotMatch(screens.textContent, /Add New Screen/, 'viewer sees no Add Screen button');
  const media = await ctx.views.MediaView(() => {});
  assert.doesNotMatch(media.textContent, /Upload media/, 'viewer sees no upload button');
  ctx.restore();
});

test('superadmin console renders tenants and platform health', async () => {
  const ctx = await boot();
  const suToken = (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'superadmin@brandcast.tv', password: 'superadmin123' }),
  })).json()).token;
  ctx.core.state.token = suToken;
  ctx.core.state.me = await ctx.core.api('/auth/me');

  const text = await render(ctx.views.SuperadminView, ctx);
  assert.match(text, /Organizations/);
  assert.match(text, /Acme Retail India/);
  assert.match(text, /Support login/);
  assert.match(text, /MRR/);
  ctx.restore();
});

test('TV player page contains pairing UI and offline caching logic', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/tv/index.html'), 'utf8');
  assert.match(html, /bc_payload/, 'caches payload locally');
  assert.match(html, /device\/session/, 'opens the realtime session');
  assert.match(html, /type: 'ack'/, 'acknowledges publishes');
  assert.match(html, /type: 'play'/, 'reports play events');
  assert.match(html, /playing cache/, 'falls back to cache when offline');
  assert.match(html, /setTimeout\(connect, 4000\)/, 'auto-reconnects');
});

test('views render in the selected language, not just the nav chrome', async () => {
  const ctx = await boot();
  const i18n = await import(pathToFileURL(path.join(ROOT, 'public/dashboard/i18n.js')).href);

  // English baseline
  i18n.setLocale('en');
  const enScreens = (await ctx.views.ScreensView(() => {})).textContent;
  const enMedia = (await ctx.views.MediaView(() => {})).textContent;
  const enBilling = (await ctx.views.BillingView(() => {})).textContent;
  assert.match(enScreens, /Add New Screen/);
  assert.match(enMedia, /Upload media/);
  assert.match(enBilling, /Current plan/);

  // Hindi: view bodies must translate, not only the sidebar
  i18n.setLocale('hi');
  const hiScreens = (await ctx.views.ScreensView(() => {})).textContent;
  const hiMedia = (await ctx.views.MediaView(() => {})).textContent;
  const hiBilling = (await ctx.views.BillingView(() => {})).textContent;
  assert.match(hiScreens, /नई स्क्रीन जोड़ें/, 'Screens action button is translated');
  assert.doesNotMatch(hiScreens, /Add New Screen/, 'English string is gone');
  assert.match(hiMedia, /मीडिया अपलोड करें/, 'Media action button is translated');
  assert.match(hiBilling, /वर्तमान योजना/, 'Billing labels are translated');

  // Tamil and Arabic reach the view layer too
  i18n.setLocale('ta');
  assert.match((await ctx.views.ScreensView(() => {})).textContent, /புதிய திரை சேர்/);
  i18n.setLocale('ar');
  assert.match((await ctx.views.ScreensView(() => {})).textContent, /إضافة شاشة جديدة/);

  i18n.setLocale('en');
  ctx.restore();
});

test('EVERY view renders localized, not just the sampled few', async () => {
  const ctx = await boot();
  const i18n = await import(pathToFileURL(path.join(ROOT, 'public/dashboard/i18n.js')).href);

  // Views that take a rerender callback and fetch their own data.
  const views = [
    'DashboardView', 'ScreensView', 'MediaView', 'PlaylistsView', 'TickersView',
    'SchedulesView', 'BranchesView', 'AnalyticsView', 'TeamView', 'BillingView',
    'SettingsView', 'AuditView',
  ];

  i18n.setLocale('hi');
  const devanagari = /[\u0900-\u097F]/;
  const failures = [];
  for (const name of views) {
    const node = await ctx.views[name](() => {});
    if (!devanagari.test(node.textContent)) failures.push(name);
  }
  // static views take no arguments
  for (const name of ['LoginView', 'AcceptInviteView']) {
    const node = ctx.views[name]();
    if (!devanagari.test(node.textContent)) failures.push(name);
  }
  i18n.setLocale('en');
  ctx.restore();
  assert.deepEqual(failures, [], `these views render no Hindi at all: ${failures.join(', ')}`);
});

test('every view module imports i18n and uses it', async () => {
  for (const f of ['views-core.js', 'views-content.js', 'views-ops.js', 'app.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'public/dashboard', f), 'utf8');
    assert.match(src, /from '\.\/i18n\.js'/, `${f} imports i18n`);
    const calls = (src.match(/[^a-zA-Z]tr\('/g) || []).length;
    assert.ok(calls >= 5, `${f} actually uses the translator (found ${calls})`);
  }
});

/* The suite previously called view functions directly and never executed app.js,
   so a ReferenceError inside render() shipped while every test passed. This boots
   the real entry point the way a browser does. */
async function bootApp(hash, tokenOverride) {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: `${BASE}/${hash}`, pretendToBeVisual: true });
  const w = dom.window;
  w.localStorage.setItem('bc_token', tokenOverride || token);
  w.fetch = (url, opts) => realFetch(String(url).startsWith('http') ? String(url) : BASE + url, opts);
  w.WebSocket = class { constructor() { this.readyState = 0; } close() {} send() {} addEventListener() {} };
  w.confirm = () => true;

  const g = globalThis;
  const saved = {
    window: g.window, document: g.document, localStorage: g.localStorage, fetch: g.fetch,
    WebSocket: g.WebSocket, Node: g.Node, FormData: g.FormData, Blob: g.Blob,
    MutationObserver: g.MutationObserver, navigator: g.navigator, location: g.location,
  };
  Object.assign(g, {
    window: w, document: w.document, localStorage: w.localStorage, fetch: w.fetch,
    WebSocket: w.WebSocket, Node: w.Node, FormData: w.FormData, Blob: w.Blob,
    MutationObserver: w.MutationObserver,
  });
  Object.defineProperty(g, 'location', { value: w.location, configurable: true, writable: true });
  Object.defineProperty(g, 'navigator', { value: w.navigator, configurable: true, writable: true });

  const failures = [];
  const onReject = (e) => failures.push(String(e?.stack || e));
  process.on('unhandledRejection', onReject);

  // app.js imports core.js statically, so busting app.js still shares one core module.
  // Clear the cached session so each boot starts from the given token.
  const core = await import(pathToFileURL(path.join(ROOT, 'public/dashboard/core.js')).href);
  core.state.me = null;
  core.state.ws = null;
  core.state.token = tokenOverride || token;

  await import(pathToFileURL(path.join(ROOT, 'public/dashboard/app.js')).href + `?boot=${Date.now()}${Math.random()}`);
  await new Promise((r) => setTimeout(r, 900));

  process.off('unhandledRejection', onReject);
  const text = w.document.getElementById('root').textContent;
  Object.assign(g, saved);
  return { text, failures, w };
}

test('the app actually boots and paints past the loading screen', async () => {
  const { text, failures } = await bootApp('#/dashboard');
  assert.deepEqual(failures, [], `app.js threw during render: ${failures[0] || ''}`);
  assert.doesNotMatch(text, /^Loading Brandcast TV/, 'still stuck on the boot placeholder');
  assert.match(text, /Brandcast TV/, 'shell rendered');
  assert.match(text, /Total screens|Overview/, 'the overview view rendered');
});

test('the app boots for a superadmin too', async () => {
  const suToken = (await (await realFetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'superadmin@brandcast.tv', password: 'superadmin123' }),
  })).json()).token;
  // a superadmin with no tenant context is redirected to the platform console
  const { text, failures } = await bootApp('#/dashboard', suToken);
  assert.deepEqual(failures, [], `app.js threw for superadmin: ${failures[0] || ''}`);
  assert.doesNotMatch(text, /^Loading Brandcast TV/, 'still stuck on the boot placeholder');
  assert.match(text, /Platform Admin|Tenants|Organizations/, 'superadmin lands on the platform console');
});

test('every route boots without throwing', async () => {
  const routes = ['/dashboard', '/screens', '/media', '/playlists', '/tickers',
                  '/schedules', '/branches', '/analytics', '/team', '/billing',
                  '/audit', '/settings'];
  const broken = [];
  for (const r of routes) {
    const { text, failures } = await bootApp(`#${r}`);
    if (failures.length || /^Loading Brandcast TV/.test(text)) broken.push(r);
  }
  assert.deepEqual(broken, [], `these routes fail to render: ${broken.join(', ')}`);
});

test('all client modules parse as valid JavaScript', async () => {
  const { execFileSync } = await import('node:child_process');
  const dir = path.join(ROOT, 'public/dashboard');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    execFileSync(process.execPath, ['--check', path.join(dir, f)]);
  }
});
