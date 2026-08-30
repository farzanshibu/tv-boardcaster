/* Apply the committed migrations and exit. Runs in CI and in a deploy step. */
import { closeDb, runMigrations } from '../src/db/client.js';

await runMigrations();
console.log('[db] migrations applied');
await closeDb();
