// SOT: transcode-queue, worker-pool, job-claim, retries
// WHAT:  the durable queue and worker pool that run media renditions.
// WHY:   an in-memory array loses every queued upload on restart and pins the whole
//        backlog to one process, so a burst of uploads transcodes strictly one at a
//        time on the node that happened to receive them.
// HOW:   jobs are rows. `FOR UPDATE SKIP LOCKED` lets N workers on N nodes claim N
//        different rows in one pass instead of queueing behind each other. The source
//        is read from object storage rather than the uploader's temp file, which is
//        what lets another node do the work. Failures back off and retry; a worker
//        that dies mid-job has its lease reclaimed.
// WHERE: ffmpeg itself is in src/lib/transcode.ts; enqueued from src/routes/content.ts

import fs from 'node:fs';
import os from 'node:os';
import { and, count, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { media, notifications, transcodeJobs } from '../db/schema.js';
import type { TranscodeJob } from '../db/schema.js';
import * as bus from './bus.js';
import { now, uid } from './ids.js';
import { downloadTo, storageReady } from './storage.js';
import { transcodeImage, transcodeVideo } from './transcode.js';

/** How many jobs this process runs at once. 0 makes it a queue-only node. */
export const CONCURRENCY = (() => {
  const raw = process.env.TRANSCODE_CONCURRENCY;
  if (raw !== undefined) return Math.max(0, Number(raw) || 0);
  return Math.max(1, Math.min(2, (os.cpus()?.length || 2) - 1));
})();

const POLL_MS = Number(process.env.TRANSCODE_POLL_MS ?? 1000);
/** A claim older than this is assumed dead and goes back on the queue. */
const LEASE_MS = Number(process.env.TRANSCODE_LEASE_MS ?? 20 * 60_000);
const MAX_ATTEMPTS = Number(process.env.TRANSCODE_MAX_ATTEMPTS ?? 3);
const DONE_RETENTION_MS = Number(process.env.TRANSCODE_RETENTION_MS ?? 7 * 864e5);

const backoffMs = (attempts: number): number =>
  Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 15 * 60_000);

let workers: Promise<void>[] = [];
let reclaimer: NodeJS.Timeout | null = null;
let stopping = false;

/** Wakers for idle workers, so an enqueue here starts one without waiting a poll. */
const waiters = new Set<() => void>();
const nudge = (): void => { for (const w of [...waiters]) w(); };

/* ------------------------------------------------------------------ *
 * Enqueue
 * ------------------------------------------------------------------ */

export type EnqueueArgs = {
  type: 'video' | 'image';
  orgId: string;
  mediaId: string;
  name?: string;
  /** This node's temp file, used when the job runs here before cleanup. */
  sourcePath?: string;
  /** Object-storage key: what lets a worker on another node pick the job up. */
  sourceKey?: string;
  cleanup?: boolean;
};

/**
 * Queue a transcode. The upload responds as soon as the row is written; renditions
 * land asynchronously and media.rendition_status is the progress indicator.
 */
export async function enqueueTranscode(args: EnqueueArgs): Promise<string> {
  const id = uid('tjb');
  const ts = now();
  await db.insert(transcodeJobs).values({
    id,
    org_id: args.orgId,
    media_id: args.mediaId,
    kind: args.type,
    name: args.name ?? '',
    source_path: args.sourcePath ?? null,
    source_key: args.sourceKey ?? null,
    cleanup: args.cleanup ? 1 : 0,
    status: 'queued',
    attempts: 0,
    max_attempts: MAX_ATTEMPTS,
    available_at: ts,
    created_at: ts,
    updated_at: ts,
  });
  await db.update(media)
    .set({ rendition_status: 'queued', rendition_error: null })
    .where(eq(media.id, args.mediaId));
  nudge();
  return id;
}

export async function queueDepth(): Promise<number> {
  const [row] = await db.select({ c: count() }).from(transcodeJobs)
    .where(inArray(transcodeJobs.status, ['queued', 'processing']));
  return row?.c ?? 0;
}

export type QueueStats = {
  queued: number; processing: number; done: number; failed: number;
  concurrency: number; node_id: string;
};

export async function queueStats(): Promise<QueueStats> {
  const rows = await db.select({ status: transcodeJobs.status, c: count() })
    .from(transcodeJobs).groupBy(transcodeJobs.status);
  const by = Object.fromEntries(rows.map((r) => [r.status, r.c]));
  return {
    queued: by.queued ?? 0,
    processing: by.processing ?? 0,
    done: by.done ?? 0,
    failed: by.failed ?? 0,
    concurrency: CONCURRENCY,
    node_id: bus.NODE_ID,
  };
}

/* ------------------------------------------------------------------ *
 * Claim
 * ------------------------------------------------------------------ */

/**
 * Take one runnable job, or null.
 * The inner SELECT locks a single row and SKIP LOCKED steps over rows another worker
 * is already claiming, so N concurrent claims return N distinct jobs.
 */
async function claim(workerId: string): Promise<TranscodeJob | null> {
  const ts = now();
  const result = await db.execute<TranscodeJob>(sql`
    UPDATE ${transcodeJobs}
       SET status = 'processing',
           attempts = ${transcodeJobs.attempts} + 1,
           locked_by = ${workerId},
           locked_at = ${ts},
           updated_at = ${ts}
     WHERE id = (
       SELECT id FROM ${transcodeJobs}
        WHERE status = 'queued' AND available_at <= ${ts}
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
     RETURNING *
  `);
  return result.rows[0] ?? null;
}

/** Put leases from dead workers back on the queue and prune finished rows. */
export async function reclaimStale(): Promise<number> {
  const cutoff = new Date(Date.now() - LEASE_MS).toISOString();
  const requeued = await db.update(transcodeJobs)
    .set({ status: 'queued', locked_by: null, locked_at: null, updated_at: now() })
    .where(and(eq(transcodeJobs.status, 'processing'), lt(transcodeJobs.locked_at, cutoff)))
    .returning({ id: transcodeJobs.id });

  await db.delete(transcodeJobs).where(and(
    inArray(transcodeJobs.status, ['done', 'failed']),
    lt(transcodeJobs.updated_at, new Date(Date.now() - DONE_RETENTION_MS).toISOString()),
  ));
  return requeued.length;
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

/**
 * The uploader's temp file only exists on the node that received the upload, and only
 * until it is cleaned up. Object storage is the source every worker can reach.
 */
async function resolveSource(job: TranscodeJob): Promise<{ path: string; temp: boolean }> {
  if (job.source_path && fs.existsSync(job.source_path)) return { path: job.source_path, temp: false };
  if (job.source_key && storageReady()) return { path: await downloadTo(job.source_key), temp: true };
  throw new Error(`source_unavailable:${job.source_key || job.source_path || 'none'}`);
}

async function runJob(job: TranscodeJob): Promise<void> {
  const source = await resolveSource(job);
  try {
    const args = { orgId: job.org_id, mediaId: job.media_id, sourcePath: source.path };
    const result = job.kind === 'video' ? await transcodeVideo(args) : await transcodeImage(args);
    await db.update(media)
      .set({ renditions: JSON.stringify(result), rendition_status: 'ready', rendition_error: null })
      .where(eq(media.id, job.media_id));
    await db.update(transcodeJobs)
      .set({ status: 'done', error: null, updated_at: now() })
      .where(eq(transcodeJobs.id, job.id));
    await db.insert(notifications).values({
      id: uid('ntf'), org_id: job.org_id, kind: 'media_ready',
      message: `"${job.name}" is ready for streaming`, read: 0, created_at: now(),
    });
  } finally {
    if (source.temp) fs.rmSync(source.path, { force: true });
    // The uploader's copy is only ours to delete once the bytes are safely in storage,
    // which is exactly what `cleanup` records.
    if (job.cleanup && job.source_path) fs.rmSync(job.source_path, { force: true });
  }
}

async function failJob(job: TranscodeJob, err: unknown): Promise<void> {
  const message = String((err as Error)?.message ?? err).slice(0, 500);
  if (job.attempts < (job.max_attempts || MAX_ATTEMPTS)) {
    await db.update(transcodeJobs).set({
      status: 'queued',
      error: message,
      locked_by: null,
      locked_at: null,
      available_at: new Date(Date.now() + backoffMs(job.attempts)).toISOString(),
      updated_at: now(),
    }).where(eq(transcodeJobs.id, job.id));
    console.warn(`[transcode] ${job.id} attempt ${job.attempts} failed (${message}); retrying`);
    return;
  }
  await db.update(transcodeJobs)
    .set({ status: 'failed', error: message, locked_by: null, updated_at: now() })
    .where(eq(transcodeJobs.id, job.id));
  await db.update(media)
    .set({ rendition_status: 'failed', rendition_error: message })
    .where(eq(media.id, job.media_id));
  console.error('[transcode]', message);
}

/* ------------------------------------------------------------------ *
 * Pool
 * ------------------------------------------------------------------ */

const idle = (ms: number): Promise<void> => new Promise((resolve) => {
  const done = (): void => { clearTimeout(timer); waiters.delete(done); resolve(); };
  const timer = setTimeout(done, ms);
  timer.unref?.();
  waiters.add(done);
});

async function workerLoop(workerId: string): Promise<void> {
  while (!stopping) {
    let job: TranscodeJob | null = null;
    try {
      job = await claim(workerId);
    } catch (err) {
      console.error('[transcode] claim failed', (err as Error).message);
    }
    if (!job) { await idle(POLL_MS); continue; }
    try {
      await db.update(media).set({ rendition_status: 'processing' }).where(eq(media.id, job.media_id));
      await runJob(job);
    } catch (err) {
      await failJob(job, err).catch((e: Error) => console.error('[transcode] fail bookkeeping', e.message));
    }
  }
}

/**
 * Start the pool. `TRANSCODE_CONCURRENCY=0` leaves the queue to a dedicated worker
 * fleet (`bun scripts/transcode-worker.ts`) while the API node only enqueues.
 */
export function startWorkers(countOfWorkers = CONCURRENCY): number {
  if (workers.length || countOfWorkers <= 0) return workers.length;
  stopping = false;
  for (let i = 0; i < countOfWorkers; i++) workers.push(workerLoop(`${bus.NODE_ID}#${i}`));
  reclaimer = setInterval(
    () => { void reclaimStale().catch((e: Error) => console.error('[transcode] reclaim', e.message)); },
    Number(process.env.TRANSCODE_RECLAIM_MS ?? 60_000),
  );
  reclaimer.unref?.();
  return workers.length;
}

export async function stopWorkers(): Promise<void> {
  stopping = true;
  if (reclaimer) { clearInterval(reclaimer); reclaimer = null; }
  nudge();
  await Promise.allSettled(workers);
  workers = [];
}
