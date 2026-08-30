// SOT: database-connection, pool, migrations, transactions
// WHAT:  the Postgres pool and the Drizzle handle every service queries through.
// WHY:   several app nodes share one database, so the connection is pooled and the
//        schema is applied by a migration runner rather than by whoever booted first.
// HOW:   `db` is the Drizzle instance bound to src/db/schema.ts. `runMigrations()`
//        applies the committed SQL under ./drizzle inside an advisory lock, so two
//        nodes starting together do not race each other through the same migration.
// WHERE: schema in src/db/schema.ts; generated SQL in ./drizzle

import path from 'node:path';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { ROOT } from '../lib/paths.js';
import * as schema from './schema.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required. Start Postgres with `docker compose up -d postgres` ' +
    'or point it at your own instance.',
  );
}

// COUNT(*) is int8, which node-postgres hands back as a string so a big count cannot
// silently lose precision. Ours are row tallies; the API publishes them as numbers.
pg.types.setTypeParser(pg.types.builtins.INT8, (v: string) => Number(v));

export const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 10_000),
  ...(process.env.PGSSLMODE === 'require' ? { ssl: { rejectUnauthorized: false } } : {}),
});

// An idle client dropped by the server (a failover, an idle timeout on a proxy) emits
// here. Without a listener it would be an uncaught exception and take the node down.
pool.on('error', (err) => console.error('[db] idle client error:', err.message));

export const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema });
export type Database = typeof db;
/** What `db.transaction((tx) => ...)` hands the callback. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Either the pool-backed handle or a transaction — services accept both. */
export type DB = Database | Tx;

/** Any 64-bit constant; it only has to be the same in every node of this service. */
const MIGRATION_LOCK_KEY = 4_192_837_465;

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await migrate(db, { migrationsFolder: path.join(ROOT, 'drizzle') });
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
    client.release();
  }
}

export async function closeDb(): Promise<void> {
  await pool.end();
}

export { schema };
