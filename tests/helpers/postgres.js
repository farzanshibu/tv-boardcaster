/*
 * Test harness: a private Postgres database and a real server process per suite.
 *
 * The suites exercise HTTP, WebSockets and background jobs, so they run against a
 * server that is actually started, not an in-process app object. Each suite gets its
 * own database so they cannot see each other's rows, and the child is killed even if
 * the suite aborts — a survivor holds the port and breaks the next run.
 *
 * Databases are cloned from a migrated template rather than migrated one by one.
 * Applying the schema is DDL-heavy and fsync-bound (seconds, not milliseconds, on a
 * containerised Postgres), and `CREATE DATABASE ... TEMPLATE` is a file copy. The
 * template is named after a hash of the migrations, so editing the schema builds a
 * new one instead of silently reusing a stale copy.
 *
 * Dropping is best-effort for the same reason: teardown is not worth blocking a suite
 * on, and anything left behind is swept at the start of the next run.
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUN = process.env.BUN_PATH || 'bun';

/** The server that owns the test databases. Defaults to the compose Postgres. */
export const ADMIN_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgres://brandcast:brandcast@127.0.0.1:5433/brandcast';

const admin = () => new pg.Client({ connectionString: ADMIN_URL });

const urlFor = (name) => {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  return url.toString();
};

/** Any 64-bit constant; it only has to be the same for every suite in the run. */
const TEMPLATE_LOCK = 8_123_456_789;

/** Hash of the committed migrations, so a schema change invalidates the template. */
const templateName = (() => {
  const dir = path.join(ROOT, 'drizzle');
  const hash = crypto.createHash('sha1');
  for (const file of fs.readdirSync(dir).sort()) {
    if (file.endsWith('.sql')) hash.update(fs.readFileSync(path.join(dir, file)));
  }
  return `bc_test_tmpl_${hash.digest('hex').slice(0, 12)}`;
})();

const run = (cmd, args, env) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'ignore' });
  child.on('error', reject);
  child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
});

/** Test databases carry their creation time, so a sweep can tell runs apart. */
const STALE_AFTER_MS = 60 * 60_000;
const testDbName = (label) =>
  `bc_test_${label}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

/** Drop leftovers from earlier runs. Never touches a database this run created. */
async function sweepStaleDatabases(conn) {
  const { rows } = await conn.query(
    "SELECT datname FROM pg_database WHERE datname LIKE 'bc\\_test\\_%' ESCAPE '\\'",
  );
  for (const { datname } of rows) {
    const stamp = datname.split('_')[3];
    const created = stamp ? parseInt(stamp, 36) : NaN;
    if (!Number.isFinite(created) || Date.now() - created < STALE_AFTER_MS) continue;
    await conn.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [datname],
    ).catch(() => {});
    await conn.query(`DROP DATABASE IF EXISTS "${datname}"`).catch(() => {});
  }
}

let templateReady = null;

/** Build the migrated template once per machine, under a lock so suites do not race. */
function ensureTemplate() {
  templateReady ??= (async () => {
    const conn = admin();
    await conn.connect();
    try {
      await conn.query('SELECT pg_advisory_lock($1)', [TEMPLATE_LOCK]);
      await sweepStaleDatabases(conn);
      const { rowCount } = await conn.query('SELECT 1 FROM pg_database WHERE datname = $1', [templateName]);
      if (!rowCount) {
        await conn.query(`CREATE DATABASE "${templateName}"`);
        // The app's own migrator, so the template is exactly what a real boot produces.
        await run(BUN, ['scripts/migrate.ts'], { DATABASE_URL: urlFor(templateName) });
      }
    } finally {
      await conn.query('SELECT pg_advisory_unlock($1)', [TEMPLATE_LOCK]).catch(() => {});
      await conn.end();
    }
    return templateName;
  })();
  return templateReady;
}

export async function createTestDatabase(label) {
  const template = await ensureTemplate();
  const name = testDbName(label);
  const conn = admin();
  await conn.connect();
  try {
    // TEMPLATE refuses while anything is connected to the source, and several suites
    // start at once, so serialise the clones behind the same lock.
    await conn.query('SELECT pg_advisory_lock($1)', [TEMPLATE_LOCK]);
    await conn.query(`CREATE DATABASE "${name}" TEMPLATE "${template}"`);
  } finally {
    await conn.query('SELECT pg_advisory_unlock($1)', [TEMPLATE_LOCK]).catch(() => {});
    await conn.end();
  }

  return {
    name,
    url: urlFor(name),
    async drop() {
      const c = admin();
      await c.connect();
      try {
        // The server under test may still be closing its pool; evict whatever is
        // left, or DROP DATABASE refuses.
        await c.query(
          'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
          [name],
        );
        await c.query(`DROP DATABASE IF EXISTS "${name}"`);
      } finally {
        await c.end().catch(() => {});
      }
    },
  };
}

/** Poll until the server answers, so a slow boot is not reported as a failure. */
export async function waitForHealth(base, attempts = 400, intervalMs = 150) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return await res.json();
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`server did not start at ${base}`);
}

/**
 * Create a database, start the API on `port`, and wait for it to answer.
 * Pass an existing `database` to start a second node against the same data — which
 * is the whole point of the fan-out tests.
 * Returns a `stop()` that kills the server and drops the database it owns.
 */
export async function startServer({ label, port, env = {}, database: existing }) {
  const database = existing ?? await createTestDatabase(label);
  const ownsDatabase = !existing;

  // TEST_SERVER_STDIO=inherit surfaces the child's logs when a suite will not boot.
  const stdio = process.env.TEST_SERVER_STDIO === 'inherit'
    ? ['ignore', 'inherit', 'inherit']
    : 'ignore';

  const proc = spawn(BUN, ['src/server.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: database.url,
      API_ONLY: '1',
      STORAGE_DRIVER: 'local',
      ...env,
    },
    stdio,
  });

  // A suite that throws before `after` runs would otherwise leave this process
  // holding the port, and every later run would fail to bind.
  const kill = () => { try { proc.kill(); } catch { /* already gone */ } };
  process.on('exit', kill);
  process.on('SIGINT', kill);

  const base = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(base);
  } catch (err) {
    kill();
    if (ownsDatabase) await database.drop().catch(() => {});
    throw err;
  }

  return {
    proc,
    database,
    base,
    async stop() {
      process.off('exit', kill);
      process.off('SIGINT', kill);
      kill();
      // Bounded: a slow drop must not turn into a failing teardown hook. Whatever
      // survives is swept at the start of the next run.
      if (ownsDatabase) await withTimeout(database.drop(), 8000);
    },
  };
}

const withTimeout = (promise, ms) => Promise.race([
  promise.catch(() => {}),
  new Promise((resolve) => setTimeout(resolve, ms).unref?.()),
]);
