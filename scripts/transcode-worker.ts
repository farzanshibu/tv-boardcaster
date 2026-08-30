/*
 * Dedicated transcode worker.
 *
 * API nodes can run with TRANSCODE_CONCURRENCY=0 so they only enqueue, and a pool of
 * these processes does the ffmpeg work. They share the queue table and the object
 * store, so a worker needs nothing from the node that took the upload.
 *
 *   DATABASE_URL=... MINIO_ENDPOINT=... bun scripts/transcode-worker.ts
 */
import { closeDb, runMigrations } from '../src/db/client.js';
import { NODE_ID, initBus } from '../src/lib/bus.js';
import { initStorage } from '../src/lib/storage.js';
import { CONCURRENCY, queueStats, reclaimStale, startWorkers, stopWorkers } from '../src/lib/queue.js';

await runMigrations();
await initBus();
const storage = await initStorage();
if (storage.driver !== 'minio') {
  // Local disk is per-node, so a worker elsewhere could never read the source file.
  console.warn('[worker] object storage unavailable; only jobs whose source file is on this host can run');
}

const started = startWorkers(CONCURRENCY || 1);
console.log(`[worker] node=${NODE_ID} storage=${storage.driver} workers=${started}`);
console.log('[worker] queue', await queueStats());

// A job abandoned by a worker that died keeps its lease until it expires; whoever is
// running sweeps it back onto the queue.
const sweeper = setInterval(() => {
  void reclaimStale().catch((e: Error) => console.error('[worker] reclaim', e.message));
}, Number(process.env.TRANSCODE_RECLAIM_MS ?? 60_000));

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    // A second signal means someone is impatient; stop pretending to drain.
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    console.log(`[worker] ${signal}: finishing in-flight jobs`);
    clearInterval(sweeper);
    void stopWorkers().then(closeDb).then(() => process.exit(0));
  });
}
