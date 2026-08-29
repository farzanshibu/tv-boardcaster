/* Non-functional requirements from PRD s8 and s12:
   rate limiting, pairing-token hardening, accessibility and localization. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BUN = process.env.BUN_PATH || 'bun';
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
  proc = spawn(BUN, ['src/server.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT), DB_PATH, RATE_LIMIT_AUTH: '5', RATE_LIMIT_SIGNUP: '3', API_ONLY: '1', STORAGE_DRIVER: 'local' }, stdio: 'ignore',
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

/* ---------- localization (Next.js + typed dictionary) ---------- */

const WEB = path.join(ROOT, 'web', 'src');

test('every locale defines the full English key set', () => {
  const src = fs.readFileSync(path.join(WEB, 'lib/dictionaries.ts'), 'utf8');

  const keysOf = (marker) => {
    const start = src.indexOf(marker);
    assert.ok(start > -1, `missing block ${marker}`);
    const end = src.indexOf('\n};', start);
    return new Set([...src.slice(start, end).matchAll(/"([a-z]+\.[a-z_]+)":/g)].map((m) => m[1]));
  };

  const en = keysOf('const en = {');
  assert.ok(en.size >= 90, `expected a substantial dictionary, got ${en.size}`);

  for (const loc of ['hi', 'ta', 'kn', 'ar']) {
    const k = keysOf(`const ${loc}: Dictionary = {`);
    const missing = [...en].filter((x) => !k.has(x));
    assert.equal(missing.length, 0, `locale ${loc} is missing: ${missing.slice(0, 5).join(', ')}`);
  }
  assert.ok(!src.includes('\uFFFD'), 'no mojibake in translated strings');
});

test('regional Indian languages and RTL are shipped', () => {
  const src = fs.readFileSync(path.join(WEB, 'lib/dictionaries.ts'), 'utf8');
  for (const code of ['hi:', 'ta:', 'kn:', 'ar:']) {
    assert.ok(src.includes(`  ${code}`), `locale ${code} present`);
  }
  assert.match(src, /RTL_LOCALES[^=]*=\s*new Set<Locale>\(\["ar"\]\)/, 'Arabic marked RTL');
});

test('the translator is typed, so an unknown key cannot compile', () => {
  const i18n = fs.readFileSync(path.join(WEB, 'lib/i18n.tsx'), 'utf8');
  assert.match(i18n, /key: TranslationKey/, 't() accepts only known keys');
  assert.match(i18n, /document\.documentElement\.dir/, 'sets document direction');
  assert.match(i18n, /localStorage\.setItem/, 'persists the choice');
});

test('every dashboard view is localized, not just the shell', () => {
  const pages = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'page.tsx') pages.push(full);
    }
  };
  walk(path.join(WEB, 'app'));
  assert.ok(pages.length >= 14, `expected the full route set, found ${pages.length}`);

  const untranslated = pages.filter((p) => {
    const src = fs.readFileSync(p, 'utf8');
    // The TV player and the root redirect render no dashboard chrome.
    if (p.includes('/tv/') || p.endsWith(path.join('app', 'page.tsx'))) return false;
    return !src.includes('t("');
  });
  assert.deepEqual(untranslated.map((p) => path.relative(WEB, p)), [], 'these views use no translations');
});

/* ---------- accessibility ---------- */

test('the app shell exposes landmarks, a skip link and labelled nav', () => {
  const shell = fs.readFileSync(path.join(WEB, 'components/global/dashboard-shell.tsx'), 'utf8');
  assert.match(shell, /skip-link/, 'skip-to-content link');
  assert.match(shell, /<nav[\s\S]{0,120}aria-label=/, 'navigation landmark is labelled');
  assert.match(shell, /<main/, 'main landmark');
  assert.match(shell, /aria-current/, 'current page announced');
  assert.match(shell, /aria-hidden="true"/, 'decorative icons hidden from screen readers');
});

test('modals are accessible dialogs', () => {
  const dialog = fs.readFileSync(path.join(WEB, 'components/global/form-dialog.tsx'), 'utf8');
  // HeroUI Modal is built on React Aria: focus trap, Escape and restore come from
  // the library rather than bespoke handlers, so assert we use those primitives.
  assert.match(dialog, /Modal\.Dialog/, 'uses the React Aria dialog primitive');
  assert.match(dialog, /Modal\.Heading/, 'dialog has an accessible heading');
  assert.match(dialog, /onOpenChange/, 'controlled open state drives focus restore');
});

test('every form control is programmatically labelled', () => {
  const form = fs.readFileSync(path.join(WEB, 'components/global/form.tsx'), 'utf8');
  assert.match(form, /<Label>/, 'TextField composes a real Label');
  assert.match(form, /aria-label=/, 'Select falls back to an aria-label');
});

test('stylesheet uses logical properties and respects reduced motion', () => {
  const css = fs.readFileSync(path.join(WEB, 'app/globals.css'), 'utf8');
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(body, /text-align:\s*(left|right)/, 'use text-align:start/end');
  assert.match(body, /inset-inline/, 'logical inset properties present');
  assert.match(body, /prefers-reduced-motion/, 'respects reduced motion');
  assert.match(body, /:focus-visible/, 'visible focus indicator');
});

test('the TV player marks up its pairing screen for assistive tech', () => {
  const tv = fs.readFileSync(path.join(WEB, 'app/tv/page.tsx'), 'utf8');
  assert.match(tv, /role="status"/, 'pairing state is announced');
  assert.match(tv, /aria-live="polite"/);
  assert.match(tv, /aria-label="Pairing code"/);
});

test('the TV player caches content and reconnects when offline', () => {
  const tv = fs.readFileSync(path.join(WEB, 'app/tv/page.tsx'), 'utf8');
  assert.match(tv, /bc_payload/, 'caches the last payload');
  assert.match(tv, /device\/session/, 'opens the realtime session');
  assert.match(tv, /type: "ack"/, 'acknowledges publishes');
  assert.match(tv, /type: "play"/, 'reports play events');
  assert.match(tv, /setTimeout\(connect, 4000\)/, 'auto-reconnects');
});
