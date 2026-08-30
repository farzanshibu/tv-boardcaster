// SOT: analytics, uptime, content-analytics, notifications, audit-log-api
// WHAT:  what the fleet did — uptime per screen, what actually played, what changed.
// WHY:   uptime is not a stored number; it is the integral of the online/offline
//        transitions over a window, so it is derived from status_events rather than
//        sampled. That way a screen that flapped is not reported as fully up.
// WHERE: transitions are written by src/lib/hub.ts and src/lib/jobs.ts

import { Hono } from 'hono';
import { and, between, count, desc, eq, gt, sum } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  auditLogs, branches, media, notifications, playEvents, playlists, publishEvents, screens, statusEvents,
} from '../db/schema.js';
import { requireAuth, requirePerm } from '../lib/auth.js';
import type { AppEnv } from '../lib/http.js';
import { now } from '../lib/ids.js';
import { planOf, usage } from '../lib/plans.js';

export const insights = new Hono<AppEnv>();

const thirtyDaysAgo = (): string => new Date(Date.now() - 30 * 864e5).toISOString();

/* ================= analytics ================= */

/** Uptime derived from the online/offline transitions inside the window. */
insights.get('/analytics/uptime', requireAuth, async (c) => {
  const from = c.req.query('from') ?? thirtyDaysAgo();
  const to = c.req.query('to') ?? now();
  const windowMs = Math.max(1, Date.parse(to) - Date.parse(from));
  const fleet = await db.select().from(screens).where(eq(screens.org_id, c.get('orgId')));

  const rows = [];
  for (const s of fleet) {
    const events = await db.select().from(statusEvents)
      .where(and(eq(statusEvents.screen_id, s.id), between(statusEvents.created_at, from, to)))
      .orderBy(statusEvents.created_at);

    let onlineMs = 0;
    let cursor = Date.parse(from);
    // The window opens before the first recorded transition, so the state going in
    // must be the opposite of whatever that transition was.
    let state = events.length
      ? (events[0]!.kind === 'offline' ? 'online' : 'offline')
      : s.status;
    for (const e of events) {
      const t = Date.parse(e.created_at);
      if (state === 'online') onlineMs += t - cursor;
      if (e.kind === 'online' || e.kind === 'offline') state = e.kind;
      cursor = t;
    }
    if (state === 'online') onlineMs += Date.parse(to) - cursor;

    const branch = await db.query.branches.findFirst({
      where: eq(branches.id, s.branch_id), columns: { name: true },
    });
    rows.push({
      screen_id: s.id,
      screen: s.name,
      branch: branch?.name ?? null,
      current_status: s.status,
      uptime_pct: Math.round(Math.min(100, (onlineMs / windowMs) * 100) * 10) / 10,
      online_hours: Math.round((onlineMs / 3.6e6) * 10) / 10,
      last_sync_at: s.last_sync_at,
    });
  }

  const byBranch = new Map<string, { branch: string | null; screens: number; sum: number }>();
  for (const r of rows) {
    const key = r.branch ?? 'Unassigned';
    const entry = byBranch.get(key) ?? { branch: r.branch, screens: 0, sum: 0 };
    entry.screens++;
    entry.sum += r.uptime_pct;
    byBranch.set(key, entry);
  }

  return c.json({
    from, to, screens: rows,
    by_branch: [...byBranch.values()].map((b) => ({
      branch: b.branch, screens: b.screens,
      uptime_pct: Math.round((b.sum / b.screens) * 10) / 10,
    })),
    fleet_uptime_pct: rows.length
      ? Math.round((rows.reduce((a, r) => a + r.uptime_pct, 0) / rows.length) * 10) / 10
      : 0,
  });
});

/** Play counts and seconds played, per media and per playlist. */
insights.get('/analytics/content', requireAuth, async (c) => {
  const orgId = c.get('orgId');
  const from = c.req.query('from') ?? thirtyDaysAgo();
  const to = c.req.query('to') ?? now();
  const window = and(eq(playEvents.org_id, orgId), between(playEvents.created_at, from, to));

  const mediaRows = await db.select({
    media_id: playEvents.media_id,
    plays: count(),
    seconds: sum(playEvents.duration),
  }).from(playEvents).where(window).groupBy(playEvents.media_id).orderBy(desc(count()));

  const byMedia = [];
  for (const r of mediaRows) {
    byMedia.push({
      ...r,
      seconds: Number(r.seconds ?? 0),
      media: r.media_id
        ? await db.query.media.findFirst({
            where: eq(media.id, r.media_id), columns: { name: true, type: true },
          }) ?? null
        : null,
    });
  }

  const playlistRows = await db.select({
    playlist_id: playEvents.playlist_id,
    plays: count(),
    seconds: sum(playEvents.duration),
  }).from(playEvents).where(window).groupBy(playEvents.playlist_id).orderBy(desc(count()));

  const byPlaylist = [];
  for (const r of playlistRows) {
    byPlaylist.push({
      ...r,
      seconds: Number(r.seconds ?? 0),
      playlist: r.playlist_id
        ? await db.query.playlists.findFirst({
            where: eq(playlists.id, r.playlist_id), columns: { name: true },
          }) ?? null
        : null,
    });
  }

  return c.json({ from, to, by_media: byMedia, by_playlist: byPlaylist });
});

insights.get('/analytics/overview', requireAuth, async (c) => {
  const orgId = c.get('orgId');
  const org = c.get('org');
  if (!org) return c.json({ error: 'unauthorized' }, 401);

  const fleet = await db.select().from(screens).where(eq(screens.org_id, orgId));
  const u = await usage(orgId);
  const one = async (q: Promise<{ c: number }[]>): Promise<number> => (await q)[0]?.c ?? 0;

  return c.json({
    total_screens: fleet.length,
    online_screens: fleet.filter((s) => s.status === 'online').length,
    offline_screens: fleet.filter((s) => s.status !== 'online').length,
    branches: await one(db.select({ c: count() }).from(branches)
      .where(and(eq(branches.org_id, orgId), eq(branches.status, 'active')))),
    playlists: await one(db.select({ c: count() }).from(playlists).where(eq(playlists.org_id, orgId))),
    media: await one(db.select({ c: count() }).from(media).where(eq(media.org_id, orgId))),
    users: u.users,
    plan: planOf(org),
    usage: u,
    publishes_24h: await one(db.select({ c: count() }).from(publishEvents).where(and(
      eq(publishEvents.org_id, orgId),
      gt(publishEvents.created_at, new Date(Date.now() - 864e5).toISOString()),
    ))),
    recent_activity: await db.select({
      action: auditLogs.action, actor_email: auditLogs.actor_email,
      target: auditLogs.target, created_at: auditLogs.created_at,
    }).from(auditLogs).where(eq(auditLogs.org_id, orgId))
      .orderBy(desc(auditLogs.created_at)).limit(10),
  });
});

insights.get('/audit-logs', requireAuth, requirePerm('org:write'), async (c) =>
  c.json(await db.select().from(auditLogs)
    .where(eq(auditLogs.org_id, c.get('orgId')))
    .orderBy(desc(auditLogs.created_at)).limit(200)));

/* ================= notifications ================= */

insights.get('/notifications', requireAuth, async (c) =>
  c.json(await db.select().from(notifications)
    .where(eq(notifications.org_id, c.get('orgId')))
    .orderBy(desc(notifications.created_at)).limit(100)));

insights.post('/notifications/read', requireAuth, async (c) => {
  await db.update(notifications).set({ read: 1 })
    .where(eq(notifications.org_id, c.get('orgId')));
  return c.json({ ok: true });
});
