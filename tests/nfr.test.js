/* Non-functional requirements from PRD s8 and s12:
   rate limiting, pairing-token hardening, accessibility and localization. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4324;
const BASE = `http://127.0.0.1:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `bc-nfr-${Date.now()}.db`);
const realFetch = globalThis.fetch.bind(globalThis);
let proc;

const call = async (p, { method = 'GET', body, token } = {}) => {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  const res = await realFetch(`${BASE}/api${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})), headers: res.headers };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test.before(async () => {
  // rate limiting is ON here (other suites disable it)
  proc = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT), DB_PATH, RATE_LIMIT_AUTH: '5', RATE_LIMIT_SIGNUP: '3' }, stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await realFetch(`${BASE}/api/health`)).ok) return; } catch {}
    await sleep(200);
  }
  throw new Error('server did not start');
});

test.after(() => {
  proc?.kill();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(DB_PATH + s, { force: true });
});

const ctx = {};

test('setup', async () => {
  const r = await call('/auth/signup', { method: 'POST', body: {
    name: 'NFR', email: 'nfr@test.com', password: 'password123', org_name: 'NFR Co' } });
  assert.equal(r.status, 201);
  ctx.owner = r.data.token;
  ctx.branch = (await call('/branches', { token: ctx.owner })).data[0].id;
});

/* ---------- rate limiting ---------- */

test('brute-forcing a password is throttled', async () => {
  let limited = null;
  for (let i = 0; i < 8; i++) {
    const r = await call('/auth/login', { method: 'POST', body: { email: 'nfr@test.com', password: `wrong${i}` } });
    if (r.status === 429) { limited = r; break; }
    assert.equal(r.status, 401);
  }
  assert.ok(limited, 'attacker is locked out before 8 guesses');
  assert.equal(limited.data.error, 'too_many_requests');
  assert.ok(Number(limited.data.retry_after_seconds) > 0);
  assert.ok(limited.headers.get('retry-after'), 'Retry-After header set');
  assert.equal(limited.headers.get('x-ratelimit-remaining'), '0');

  // the lockout is per-identity, so a different account still works
  const other = await call('/auth/login', { method: 'POST', body: { email: 'someone-else@test.com', password: 'x' } });
  assert.equal(other.status, 401, 'unrelated accounts are not collateral damage');
});

test('a successful login clears the throttle for that identity', async () => {
  const email = 'clearme@test.com';
  await call('/auth/signup', { method: 'POST', body: { name: 'C', email, password: 'password123', org_name: 'Clear Co' } });
  for (let i = 0; i < 3; i++) {
    await call('/auth/login', { method: 'POST', body: { email, password: 'nope' } });
  }
  assert.equal((await call('/auth/login', { method: 'POST', body: { email, password: 'password123' } })).status, 200);
  // counter reset, so a fresh run of wrong guesses is still allowed
  const after = await call('/auth/login', { method: 'POST', body: { email, password: 'nope' } });
  assert.equal(after.status, 401, 'not immediately re-locked after a genuine sign-in');
});

test('signup is rate limited to resist tenant spam', async () => {
  let limited = false;
  for (let i = 0; i < 6; i++) {
    const r = await call('/auth/signup', { method: 'POST', body: {
      name: 'Spam', email: `spam${i}-${Date.now()}@test.com`, password: 'password123', org_name: 'Spam' } });
    if (r.status === 429) { limited = true; break; }
  }
  assert.ok(limited, 'bulk tenant creation is throttled');
});

test('rate limit headers are advertised on normal responses', async () => {
  const r = await call('/pairing/generate-otp', { method: 'POST', body: { device_id: 'hdr-dev' } });
  assert.equal(r.status, 201);
  assert.ok(r.headers.get('x-ratelimit-limit'), 'limit advertised');
  assert.ok(Number(r.headers.get('x-ratelimit-remaining')) >= 0);
});

/* ---------- pairing token hardening ---------- */

test('the pairing status endpoint will not hand a device token to a stranger', async () => {
  const otp = await call('/pairing/generate-otp', { method: 'POST', body: { device_id: 'legit-device' } });
  const code = otp.data.code;

  const scr = await call('/screens', { method: 'POST', token: ctx.owner, body: {
    code, name: 'Guarded Screen', branch_id: ctx.branch } });
  assert.equal(scr.status, 201);

  // an attacker who guessed the 4-digit code but not the device id gets nothing
  const noId = await call(`/pairing/status/${code}`);
  assert.equal(noId.status, 403);
  assert.equal(noId.data.device_token, undefined);

  const wrongId = await call(`/pairing/status/${code}?device_id=attacker`);
  assert.equal(wrongId.status, 403);
  assert.equal(wrongId.data.device_token, undefined);

  // the real device gets its token
  const ok = await call(`/pairing/status/${code}?device_id=legit-device`);
  assert.equal(ok.status, 200);
  assert.ok(ok.data.device_token, 'the owning device still receives its token');

  // and that token works
  const content = await realFetch(`${BASE}/api/device/content`, { headers: { authorization: `Bearer ${ok.data.device_token}` } });
  assert.equal(content.status, 200);
});

/* ---------- localization ---------- */

test('i18n covers every key across all locales', async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'public/dashboard/i18n.js')).href);
  const src = fs.readFileSync(path.join(ROOT, 'public/dashboard/i18n.js'), 'utf8');

  assert.ok(Object.keys(mod.LOCALES).length >= 4, 'ships several languages');
  for (const code of ['hi', 'ta', 'kn']) assert.ok(mod.LOCALES[code], `regional Indian language ${code} present`);

  // every locale must define the same keys as English
  const blocks = [...src.matchAll(/^  (\w+): \{$/gm)].map((m) => m[1]);
  assert.ok(blocks.includes('en'));
  const keysOf = (loc) => {
    const start = src.indexOf(`  ${loc}: {`);
    const end = src.indexOf('\n  },', start);
    return new Set([...src.slice(start, end).matchAll(/'([a-z]+\.[a-z_]+)':/g)].map((m) => m[1]));
  };
  const enKeys = keysOf('en');
  assert.ok(enKeys.size >= 20, 'a meaningful number of strings');
  for (const loc of blocks.filter((b) => b !== 'en')) {
    const k = keysOf(loc);
    const missing = [...enKeys].filter((x) => !k.has(x));
    assert.equal(missing.length, 0, `locale ${loc} is missing: ${missing.join(', ')}`);
  }

  assert.ok(!src.includes('\uFFFD'), 'no mojibake in translated strings');
});

test('translation lookup falls back and interpolates', async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'public/dashboard/i18n.js')).href);
  assert.equal(mod.t('nav.screens'), 'Screens');
  assert.equal(mod.t('screens.online', { n: 4 }), '4 online');
  assert.equal(mod.t('totally.unknown.key'), 'totally.unknown.key', 'unknown keys degrade to the key');

  mod.setLocale('hi');
  assert.equal(mod.t('nav.screens'), 'स्क्रीन');
  assert.match(mod.t('screens.online', { n: 4 }), /^4 /, 'interpolation works in Hindi');
  mod.setLocale('en');
});

test('the dashboard renders in Hindi and flips direction for Arabic', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: BASE, runScripts: 'outside-only' });
  const w = dom.window;
  const g = globalThis;
  const saved = { window: g.window, document: g.document, localStorage: g.localStorage, navigator: g.navigator };
  Object.assign(g, { window: w, document: w.document, localStorage: w.localStorage });
  Object.defineProperty(g, 'navigator', { value: w.navigator, configurable: true, writable: true });

  const mod = await import(pathToFileURL(path.join(ROOT, 'public/dashboard/i18n.js')).href);
  mod.setLocale('hi');
  assert.equal(w.document.documentElement.lang, 'hi');
  assert.equal(w.document.documentElement.dir, 'ltr');

  mod.setLocale('ar');
  assert.equal(w.document.documentElement.dir, 'rtl', 'Arabic switches the document to RTL');

  mod.setLocale('en');
  Object.assign(g, saved);
});

/* ---------- accessibility ---------- */

test('the app shell exposes landmarks, a skip link and labelled nav', async () => {
  const appJs = fs.readFileSync(path.join(ROOT, 'public/dashboard/app.js'), 'utf8');
  assert.match(appJs, /skip-link/, 'skip-to-content link');
  assert.match(appJs, /h\('nav'.*aria-label/s, 'navigation landmark is labelled');
  assert.match(appJs, /h\('main'/, 'main landmark');
  assert.match(appJs, /aria-current/, 'current page is announced');
  assert.match(appJs, /aria-hidden': 'true'/, 'decorative icons hidden from screen readers');
  assert.match(appJs, /aria-busy/, 'loading state announced');

  const css = fs.readFileSync(path.join(ROOT, 'public/dashboard/app.css'), 'utf8');
  assert.match(css, /:focus-visible/, 'visible focus indicator');
  assert.match(css, /prefers-reduced-motion/, 'respects reduced-motion');
});

test('modals are dialogs: labelled, escapable and focus-trapping', async () => {
  const core = fs.readFileSync(path.join(ROOT, 'public/dashboard/core.js'), 'utf8');
  assert.match(core, /role: 'dialog'/);
  assert.match(core, /'aria-modal': 'true'/);
  assert.match(core, /'aria-labelledby'/);
  assert.match(core, /Escape/, 'Escape closes the dialog');
  assert.match(core, /previouslyFocused/, 'focus is restored on close');
  assert.match(core, /role: 'alert'/, 'errors are announced');
});

test('every form control is programmatically labelled', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: BASE, runScripts: 'outside-only' });
  const w = dom.window;
  const g = globalThis;
  const saved = { window: g.window, document: g.document, localStorage: g.localStorage, navigator: g.navigator, Node: g.Node, location: g.location };
  Object.assign(g, { window: w, document: w.document, localStorage: w.localStorage, Node: w.Node });
  Object.defineProperty(g, 'navigator', { value: w.navigator, configurable: true, writable: true });
  Object.defineProperty(g, 'location', { value: w.location, configurable: true, writable: true });

  const core = await import(pathToFileURL(path.join(ROOT, 'public/dashboard/core.js')).href);
  const input = core.h('input', { type: 'text' });
  const wrapped = core.field('Screen name', input);
  const label = wrapped.querySelector('label');
  assert.ok(input.id, 'the control gets an id');
  assert.equal(label.getAttribute('for'), input.id, 'label points at its control');

  // two fields must not collide
  const b = core.h('input', {});
  core.field('Other', b);
  assert.notEqual(input.id, b.id, 'ids are unique');

  Object.assign(g, saved);
});

test('the TV player marks up its pairing screen for assistive tech', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/tv/index.html'), 'utf8');
  assert.match(html, /<html lang=/, 'language declared');
  assert.match(html, /aria-live|role="status"|aria-label/, 'pairing state is announced');
});
