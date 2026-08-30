// SOT: schedule-resolution, dayparting, screen-payload, publish
// WHAT:  what a given screen should be showing right now, and how that reaches it.
// WHY:   a screen's content is not a column — it is the winner of the schedules that
//        apply to it, falling back to its own assignment and then the branch default.
//        One resolver means the dashboard preview and the device payload cannot
//        disagree about what is on screen.
// HOW:   schedules are matched in the branch's local time, then ranked by specificity
//        (screen beats branch beats org) with priority as the tie-break.
// WHERE: delivery in src/lib/hub.ts; rotation on a timer in src/lib/jobs.ts

import { and, eq, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import { branches, playlists, publishEvents, schedules, screens, tickers, media } from '../db/schema.js';
import type { Branch, Schedule, Screen } from '../db/schema.js';
import * as hub from './hub.js';
import { now, uid } from './ids.js';
import type { Renditions } from './transcode.js';

export type LocalParts = { date: string; time: string; dow: number };

/** Wall-clock date, HH:MM and day-of-week in a timezone. */
export function localParts(timezone: string | null | undefined, date: Date = new Date()): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday ?? '');
  // Some locales render midnight as 24; the rest of the system expects 00.
  const hour = p.hour === '24' ? '00' : p.hour;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${hour}:${p.minute}`, dow };
}

/** start > end means the window runs past midnight, e.g. 22:00–02:00. */
const inWindow = (t: string, start: string, end: string): boolean =>
  start <= end ? t >= start && t <= end : t >= start || t <= end;

/** Screen beats branch beats org, whatever the priority. */
const SPECIFICITY: Record<string, number> = { screen: 3, branch: 2, org: 1 };

export async function activeSchedules(screen: Screen, at: Date = new Date()): Promise<Schedule[]> {
  const branch = await db.query.branches.findFirst({ where: eq(branches.id, screen.branch_id) });
  const { date, time, dow } = localParts(branch?.timezone, at);

  const rows = await db.select().from(schedules).where(and(
    eq(schedules.org_id, screen.org_id),
    eq(schedules.enabled, 1),
    or(
      and(eq(schedules.target_type, 'screen'), eq(schedules.target_id, screen.id)),
      and(eq(schedules.target_type, 'branch'), eq(schedules.target_id, screen.branch_id)),
      eq(schedules.target_type, 'org'),
    ),
  ));

  return rows
    .filter((s) => {
      if (s.start_date && date < s.start_date) return false;
      if (s.end_date && date > s.end_date) return false;
      if (!(JSON.parse(s.days_of_week) as number[]).includes(dow)) return false;
      return inWindow(time, s.start_time, s.end_time);
    })
    .sort((a, b) =>
      ((SPECIFICITY[b.target_type] ?? 0) - (SPECIFICITY[a.target_type] ?? 0)) ||
      (b.priority - a.priority) ||
      (a.created_at < b.created_at ? 1 : -1));
}

export type ResolvedContent = {
  playlist_id: string | null;
  ticker_id: string | null;
  source: 'schedule' | 'static';
  conflicts: { id: string; name: string; target_type: string }[];
  schedule_id: string | null;
};

/** Schedules win over the static assignment, which wins over the branch default. */
export async function resolveScreenContent(screen: Screen, at: Date = new Date()): Promise<ResolvedContent> {
  const branch = await db.query.branches.findFirst({ where: eq(branches.id, screen.branch_id) });
  const active = await activeSchedules(screen, at);
  const pl = active.find((s) => s.content_type === 'playlist');
  const tk = active.find((s) => s.content_type === 'ticker');
  const playlistSchedules = active.filter((s) => s.content_type === 'playlist');

  return {
    playlist_id: pl?.content_id ?? screen.playlist_id ?? branch?.default_playlist_id ?? null,
    ticker_id: tk?.content_id ?? screen.ticker_id ?? branch?.default_ticker_id ?? null,
    source: pl ? 'schedule' : 'static',
    // Surfaced so an operator can see which schedule lost, rather than wondering.
    conflicts: playlistSchedules.length > 1
      ? playlistSchedules.map((s) => ({ id: s.id, name: s.name, target_type: s.target_type }))
      : [],
    schedule_id: pl?.id ?? null,
  };
}

export type PayloadItem = {
  media_id: string;
  name: string;
  type: string;
  url: string;
  duration: number;
  hls_url: string | null;
  poster_url: string | null;
  mp4: unknown;
  images: unknown;
};

export type ScreenPayload = {
  screen: { id: string; name: string; orientation: string; branch: string | null; timezone: string };
  playlist: { id: string; name: string; items: PayloadItem[] } | null;
  ticker: {
    id: string; text: string; position: string; speed: number; color: string; background: string;
  } | null;
  source: 'schedule' | 'static';
  conflicts: ResolvedContent['conflicts'];
  generated_at: string;
};

type PlaylistItem = { media_id: string; duration?: number };

/** The whole document the TV renders and caches for offline playback. */
export async function buildPayload(screen: Screen, at: Date = new Date()): Promise<ScreenPayload> {
  const resolved = await resolveScreenContent(screen, at);
  const branch: Branch | undefined = await db.query.branches.findFirst({
    where: eq(branches.id, screen.branch_id),
  });

  let playlist: ScreenPayload['playlist'] = null;
  if (resolved.playlist_id) {
    const p = await db.query.playlists.findFirst({ where: eq(playlists.id, resolved.playlist_id) });
    // An unapproved playlist never reaches a screen, even if it is assigned.
    if (p && p.status === 'approved') {
      const items: PayloadItem[] = [];
      for (const item of JSON.parse(p.items || '[]') as PlaylistItem[]) {
        const m = await db.query.media.findFirst({ where: eq(media.id, item.media_id) });
        if (!m || m.status !== 'approved') continue;
        // Renditions let the TV pick a bitrate and size for its own panel and link.
        const renditions = m.renditions ? JSON.parse(m.renditions) as Renditions : null;
        const video = renditions?.kind === 'video' ? renditions : null;
        const image = renditions?.kind === 'image' ? renditions : null;
        items.push({
          media_id: m.id,
          name: m.name,
          type: m.type,
          url: m.url,
          duration: item.duration || m.duration || 10,
          hls_url: video?.hls_url ?? null,
          poster_url: video?.poster_url ?? null,
          mp4: video?.mp4 ?? null,
          images: image?.variants ?? null,
        });
      }
      playlist = { id: p.id, name: p.name, items };
    }
  }

  let ticker: ScreenPayload['ticker'] = null;
  if (resolved.ticker_id) {
    const t = await db.query.tickers.findFirst({ where: eq(tickers.id, resolved.ticker_id) });
    if (t) {
      const { time } = localParts(branch?.timezone, at);
      const active = !t.start_time || !t.end_time || inWindow(time, t.start_time, t.end_time);
      if (active) {
        ticker = {
          id: t.id, text: t.text, position: t.position,
          speed: t.speed, color: t.color, background: t.background,
        };
      }
    }
  }

  return {
    screen: {
      id: screen.id, name: screen.name, orientation: screen.orientation,
      branch: branch?.name ?? null, timezone: branch?.timezone ?? 'UTC',
    },
    playlist,
    ticker,
    source: resolved.source,
    conflicts: resolved.conflicts,
    generated_at: now(),
  };
}

export type PublishResult = { publish_id: string; delivered: boolean; payload: ScreenPayload };

/**
 * Push a screen's current content over the delivery plane.
 * The row is written first and marked delivered second, so a publish that never
 * reaches the device is still visible as pending rather than lost.
 */
export async function publishToScreen(
  screen: Screen,
  { actorId = null, source = 'manual' }: { actorId?: string | null; source?: string } = {},
): Promise<PublishResult> {
  const payload = await buildPayload(screen);
  const id = uid('pub');
  await db.insert(publishEvents).values({
    id,
    org_id: screen.org_id,
    screen_id: screen.id,
    playlist_id: payload.playlist?.id ?? null,
    ticker_id: payload.ticker?.id ?? null,
    source,
    status: 'pending',
    actor_id: actorId,
    created_at: now(),
  });

  const delivered = await hub.sendTo(screen.id, { type: 'content', publish_id: id, payload });
  if (delivered) {
    await db.update(publishEvents)
      .set({ status: 'delivered', delivered_at: now() })
      .where(eq(publishEvents.id, id));
  }
  await hub.broadcastDashboard(screen.org_id, {
    type: 'publish', screen_id: screen.id, publish_id: id, status: delivered ? 'delivered' : 'pending',
  });
  return { publish_id: id, delivered, payload };
}

export async function publishToScreens(
  targets: Screen[],
  opts?: { actorId?: string | null; source?: string },
): Promise<(PublishResult & { screen_id: string })[]> {
  const out: (PublishResult & { screen_id: string })[] = [];
  for (const s of targets) out.push({ screen_id: s.id, ...(await publishToScreen(s, opts)) });
  return out;
}

/** Re-read a screen row after a write, so the publish reflects what was just saved. */
export const reloadScreen = (id: string): Promise<Screen | undefined> =>
  db.query.screens.findFirst({ where: eq(screens.id, id) });
