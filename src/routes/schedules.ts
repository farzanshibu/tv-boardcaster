// SOT: schedules, dayparting-api, conflict-detection, schedule-preview
// WHAT:  create and inspect the rules that decide what plays when.
// WHY:   overlapping schedules are normal, not an error — a store-wide loop and a
//        lunch daypart are meant to overlap. The API says which one wins rather than
//        refusing the second one.
// WHERE: resolution and ranking in src/lib/content.ts

import { Hono } from 'hono';
import { and, desc, eq, ne } from 'drizzle-orm';
import { db } from '../db/client.js';
import { branches, playlists, schedules, screens, tickers } from '../db/schema.js';
import type { Schedule } from '../db/schema.js';
import { audit, auditActor, requireAuth, requirePerm } from '../lib/auth.js';
import { activeSchedules, localParts, resolveScreenContent } from '../lib/content.js';
import type { AppEnv } from '../lib/http.js';
import { now, uid } from '../lib/ids.js';
import { schedulerTick } from '../lib/jobs.js';
import { requireFeature } from '../lib/plans.js';
import { jsonBody } from '../lib/ratelimit.js';

export const schedulesRouter = new Hono<AppEnv>();

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

schedulesRouter.get('/schedules', requireAuth, async (c) => {
  const rows = await db.select().from(schedules)
    .where(eq(schedules.org_id, c.get('orgId'))).orderBy(desc(schedules.created_at));
  return c.json(rows.map((s) => ({
    ...s,
    days_of_week: JSON.parse(s.days_of_week) as number[],
    enabled: !!s.enabled,
  })));
});

schedulesRouter.post(
  '/schedules',
  requireAuth, requirePerm('content:publish'), requireFeature('scheduling'),
  async (c) => {
    const orgId = c.get('orgId');
    const body = await jsonBody(c);
    const name = String(body.name ?? '');
    const targetType = String(body.target_type ?? 'org');
    const targetId = (body.target_id as string | null) ?? null;
    const contentType = String(body.content_type ?? 'playlist');
    const contentId = String(body.content_id ?? '');
    const startDate = (body.start_date as string | null) ?? null;
    const endDate = (body.end_date as string | null) ?? null;
    const startTime = String(body.start_time ?? '00:00');
    const endTime = String(body.end_time ?? '23:59');
    const daysOfWeek = Array.isArray(body.days_of_week)
      ? body.days_of_week as number[] : [0, 1, 2, 3, 4, 5, 6];
    const priority = Number(body.priority ?? 0);

    if (!name || !contentId) return c.json({ error: 'name and content_id required' }, 400);
    if (!['screen', 'branch', 'org'].includes(targetType)) return c.json({ error: 'bad_target_type' }, 400);
    if (targetType !== 'org' && !targetId) return c.json({ error: 'target_id required' }, 400);
    if (!HHMM.test(startTime) || !HHMM.test(endTime)) return c.json({ error: 'times must be HH:MM' }, 400);
    if (startDate && !DATE.test(startDate)) return c.json({ error: 'bad start_date' }, 400);
    if (endDate && !DATE.test(endDate)) return c.json({ error: 'bad end_date' }, 400);
    if (daysOfWeek.some((d) => d < 0 || d > 6)) return c.json({ error: 'bad days_of_week' }, 400);

    // Everything referenced has to belong to this tenant, or a schedule could point
    // at another org's playlist.
    const contentExists = contentType === 'ticker'
      ? await db.query.tickers.findFirst({ where: and(eq(tickers.id, contentId), eq(tickers.org_id, orgId)) })
      : await db.query.playlists.findFirst({ where: and(eq(playlists.id, contentId), eq(playlists.org_id, orgId)) });
    if (!contentExists) return c.json({ error: 'content_not_found' }, 400);

    if (targetType === 'screen' && !await db.query.screens.findFirst({
      where: and(eq(screens.id, targetId!), eq(screens.org_id, orgId)),
    })) return c.json({ error: 'screen_not_found' }, 400);
    if (targetType === 'branch' && !await db.query.branches.findFirst({
      where: and(eq(branches.id, targetId!), eq(branches.org_id, orgId)),
    })) return c.json({ error: 'branch_not_found' }, 400);

    const id = uid('sch');
    await db.insert(schedules).values({
      id, org_id: orgId, name,
      target_type: targetType, target_id: targetId,
      content_type: contentType, content_id: contentId,
      start_date: startDate, end_date: endDate,
      start_time: startTime, end_time: endTime,
      days_of_week: JSON.stringify(daysOfWeek),
      priority, created_at: now(),
    });
    await audit(auditActor(c), 'schedule.create', id, { name, target_type: targetType });
    // Apply it immediately rather than waiting for the next tick.
    await schedulerTick();

    const created = await db.query.schedules.findFirst({ where: eq(schedules.id, id) });
    if (!created) return c.json({ error: 'create_failed' }, 500);
    return c.json({
      ...created,
      days_of_week: JSON.parse(created.days_of_week) as number[],
      conflicts: await conflictsFor(created),
    }, 201);
  },
);

/** Narrower scope wins; priority breaks a tie within the same scope. */
const RANK: Record<string, number> = { screen: 3, branch: 2, org: 1 };
const rankOf = (s: Schedule): number => (RANK[s.target_type] ?? 0) * 1000 + s.priority;

/**
 * Schedules that overlap this one on the same targets and content type.
 * Reported, not rejected: overlapping dayparts are how the product is meant to be
 * used, so the answer is which one wins.
 */
async function conflictsFor(s: Schedule) {
  const others = await db.select().from(schedules).where(and(
    eq(schedules.org_id, s.org_id),
    ne(schedules.id, s.id),
    eq(schedules.content_type, s.content_type),
    eq(schedules.enabled, 1),
  ));
  const days = JSON.parse(s.days_of_week) as number[];
  return others
    .filter((o) => {
      const sameScope = o.target_type === 'org' || s.target_type === 'org' ||
        (o.target_type === s.target_type && o.target_id === s.target_id);
      if (!sameScope) return false;
      if (!(JSON.parse(o.days_of_week) as number[]).some((d) => days.includes(d))) return false;
      return s.start_time <= o.end_time && o.start_time <= s.end_time;
    })
    .map((o) => ({
      id: o.id,
      name: o.name,
      target_type: o.target_type,
      resolution: rankOf(s) >= rankOf(o) ? 'this_schedule_wins' : 'other_schedule_wins',
    }));
}

schedulesRouter.patch('/schedules/:id', requireAuth, requirePerm('content:publish'), async (c) => {
  const s = await db.query.schedules.findFirst({
    where: and(eq(schedules.id, c.req.param('id')), eq(schedules.org_id, c.get('orgId'))),
  });
  if (!s) return c.json({ error: 'not_found' }, 404);
  const b = await jsonBody(c);
  if (b.start_time !== undefined && !HHMM.test(String(b.start_time)))
    return c.json({ error: 'bad start_time' }, 400);
  if (b.end_time !== undefined && !HHMM.test(String(b.end_time)))
    return c.json({ error: 'bad end_time' }, 400);

  await db.update(schedules).set({
    name: b.name === undefined ? s.name : String(b.name),
    content_id: b.content_id === undefined ? s.content_id : String(b.content_id),
    start_date: b.start_date === undefined ? s.start_date : (b.start_date as string | null),
    end_date: b.end_date === undefined ? s.end_date : (b.end_date as string | null),
    start_time: b.start_time === undefined ? s.start_time : String(b.start_time),
    end_time: b.end_time === undefined ? s.end_time : String(b.end_time),
    days_of_week: b.days_of_week === undefined ? s.days_of_week : JSON.stringify(b.days_of_week),
    priority: b.priority === undefined ? s.priority : Number(b.priority),
    enabled: b.enabled === undefined ? s.enabled : (b.enabled ? 1 : 0),
  }).where(eq(schedules.id, s.id));
  await audit(auditActor(c), 'schedule.update', s.id, b);
  await schedulerTick();
  return c.json(await db.query.schedules.findFirst({ where: eq(schedules.id, s.id) }));
});

schedulesRouter.delete('/schedules/:id', requireAuth, requirePerm('content:publish'), async (c) => {
  const s = await db.query.schedules.findFirst({
    where: and(eq(schedules.id, c.req.param('id')), eq(schedules.org_id, c.get('orgId'))),
  });
  if (!s) return c.json({ error: 'not_found' }, 404);
  await db.delete(schedules).where(eq(schedules.id, s.id));
  await audit(auditActor(c), 'schedule.delete', s.id);
  // Screens governed by it fall back to their static assignment straight away.
  await schedulerTick();
  return c.json({ ok: true });
});

/** What a screen will show at a given moment, and which schedules are active then. */
schedulesRouter.get('/schedules/preview/:screen_id', requireAuth, async (c) => {
  const s = await db.query.screens.findFirst({
    where: and(eq(screens.id, c.req.param('screen_id')), eq(screens.org_id, c.get('orgId'))),
  });
  if (!s) return c.json({ error: 'not_found' }, 404);
  const atParam = c.req.query('at');
  const at = atParam ? new Date(atParam) : new Date();
  if (Number.isNaN(at.getTime())) return c.json({ error: 'bad at' }, 400);

  const branch = await db.query.branches.findFirst({ where: eq(branches.id, s.branch_id) });
  return c.json({
    at: at.toISOString(),
    local: localParts(branch?.timezone, at),
    timezone: branch?.timezone,
    active: (await activeSchedules(s, at)).map((x) => ({
      id: x.id, name: x.name, target_type: x.target_type, content_type: x.content_type,
    })),
    resolved: await resolveScreenContent(s, at),
  });
});

schedulesRouter.post('/schedules/run', requireAuth, requirePerm('content:publish'), async (c) =>
  c.json({ ok: true, republished: await schedulerTick() }));
