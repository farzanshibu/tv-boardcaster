// SOT: superadmin-console, tenant-admin, feature-flags, impersonation, platform-health
// WHAT:  the platform operator's view across every tenant.
// WHY:   support has to be able to see and act inside a customer's account, and every
//        such action has to be attributable afterwards — so impersonation issues a
//        scoped token and writes its own audit row before handing it over.
// WHERE: the token is minted by src/lib/auth.ts and honoured by requireAuth

import { Hono } from 'hono';
import { and, count, desc, eq, gt, isNotNull } from 'drizzle-orm';
import { db, pool } from '../db/client.js';
import {
  auditLogs, branches, invoices, organizations, publishEvents, screens, subscriptions, users,
} from '../db/schema.js';
import { audit, auditActor, requireAuth, requireSuperadmin, signUser } from '../lib/auth.js';
import * as bus from '../lib/bus.js';
import * as hub from '../lib/hub.js';
import type { AppEnv } from '../lib/http.js';
import { now, uid } from '../lib/ids.js';
import { billingTick, healthTick, schedulerTick } from '../lib/jobs.js';
import { isPlanTier, planOf, usage } from '../lib/plans.js';
import { queueStats, reclaimStale } from '../lib/queue.js';
import { jsonBody } from '../lib/ratelimit.js';
import { driver as storageDriver } from '../lib/storage.js';

export const superadmin = new Hono<AppEnv>();
superadmin.use('/admin/*', requireAuth, requireSuperadmin);

superadmin.get('/admin/tenants', async (c) => {
  const orgs = await db.select().from(organizations).orderBy(desc(organizations.created_at));
  const out = [];
  for (const o of orgs) {
    const u = await usage(o.id);
    const [online] = await db.select({ c: count() }).from(screens)
      .where(and(eq(screens.org_id, o.id), eq(screens.status, 'online')));
    out.push({
      ...o,
      feature_flags: JSON.parse(o.feature_flags || '{}') as Record<string, boolean>,
      usage: u,
      plan: planOf(o),
      subscription: await db.query.subscriptions.findFirst({ where: eq(subscriptions.org_id, o.id) }) ?? null,
      online_screens: online?.c ?? 0,
      revenue_mrr: planOf(o).price_per_screen * u.screens,
    });
  }
  return c.json(out);
});

superadmin.get('/admin/tenants/:id', async (c) => {
  const o = await db.query.organizations.findFirst({
    where: eq(organizations.id, c.req.param('id')),
  });
  if (!o) return c.json({ error: 'not_found' }, 404);
  return c.json({
    org: { ...o, feature_flags: JSON.parse(o.feature_flags || '{}') as Record<string, boolean> },
    users: await db.select({
      id: users.id, name: users.name, email: users.email, role: users.role, status: users.status,
    }).from(users).where(eq(users.org_id, o.id)),
    branches: await db.select().from(branches).where(eq(branches.org_id, o.id)),
    screens: await db.select({
      id: screens.id, name: screens.name, status: screens.status, last_seen_at: screens.last_seen_at,
    }).from(screens).where(eq(screens.org_id, o.id)),
    invoices: await db.select().from(invoices)
      .where(eq(invoices.org_id, o.id)).orderBy(desc(invoices.created_at)).limit(12),
    audit: await db.select().from(auditLogs)
      .where(eq(auditLogs.org_id, o.id)).orderBy(desc(auditLogs.created_at)).limit(50),
  });
});

/** Suspend or restore a tenant. Toggling is deliberate: one control, both ways. */
superadmin.post('/admin/tenants/:id/suspend', async (c) => {
  const o = await db.query.organizations.findFirst({
    where: eq(organizations.id, c.req.param('id')),
  });
  if (!o) return c.json({ error: 'not_found' }, 404);
  const status = o.status === 'suspended' ? 'active' : 'suspended';
  await db.update(organizations).set({ status }).where(eq(organizations.id, o.id));
  await audit(auditActor(c), 'admin.tenant.status', o.id, { status });
  return c.json({ ok: true, status });
});

superadmin.post('/admin/tenants/:id/plan', async (c) => {
  const body = await jsonBody(c);
  const plan = String(body.plan ?? '');
  if (!isPlanTier(plan)) return c.json({ error: 'unknown_plan' }, 400);
  const id = c.req.param('id');
  await db.transaction(async (tx) => {
    await tx.update(organizations).set({ plan_tier: plan }).where(eq(organizations.id, id));
    await tx.update(subscriptions).set({ plan, status: 'active' }).where(eq(subscriptions.org_id, id));
  });
  await audit(auditActor(c), 'admin.tenant.plan', id, { plan });
  return c.json({ ok: true, plan });
});

/** Per-org feature flags for staged rollout; they override the plan's defaults. */
superadmin.post('/admin/tenants/:id/flags', async (c) => {
  const o = await db.query.organizations.findFirst({
    where: eq(organizations.id, c.req.param('id')),
  });
  if (!o) return c.json({ error: 'not_found' }, 404);
  const body = await jsonBody(c);
  const incoming = (body.flags ?? {}) as Record<string, boolean | null>;
  const flags: Record<string, boolean> = {
    ...(JSON.parse(o.feature_flags || '{}') as Record<string, boolean>),
  };
  // null removes an override, which is different from setting it false.
  for (const [k, v] of Object.entries(incoming)) {
    if (v === null) delete flags[k];
    else flags[k] = !!v;
  }
  await db.update(organizations).set({ feature_flags: JSON.stringify(flags) })
    .where(eq(organizations.id, o.id));
  await audit(auditActor(c), 'admin.tenant.flags', o.id, flags);
  return c.json({ ok: true, feature_flags: flags });
});

/** Support login: a token scoped to the tenant, with its own audit trail. */
superadmin.post('/admin/tenants/:id/impersonate', async (c) => {
  const user = c.get('user');
  const o = await db.query.organizations.findFirst({
    where: eq(organizations.id, c.req.param('id')),
  });
  if (!o) return c.json({ error: 'not_found' }, 404);
  const body = await jsonBody(c);

  await audit(auditActor(c), 'admin.impersonate', o.id, { reason: body.reason ?? 'support' });
  // A second row inside the tenant's own log, so the customer can see it too.
  await db.insert(auditLogs).values({
    id: uid('aud'), org_id: o.id, actor_id: user.id, actor_email: user.email,
    action: 'support.session.start', target: o.id, impersonated: 1, created_at: now(),
  });
  return c.json({ token: signUser(user, { act_org: o.id }), org: { id: o.id, name: o.name } });
});

superadmin.get('/admin/health', async (c) => {
  const one = async (q: Promise<{ c: number }[]>): Promise<number> => (await q)[0]?.c ?? 0;
  const orgs = await db.select().from(organizations);

  let mrr = 0;
  for (const o of orgs) mrr += planOf(o).price_per_screen * (await usage(o.id)).screens;

  return c.json({
    organizations: orgs.length,
    screens: await one(db.select({ c: count() }).from(screens)),
    online_screens: await one(db.select({ c: count() }).from(screens).where(eq(screens.status, 'online'))),
    connected_sessions: hub.connectedCount(),
    publishes_24h: await one(db.select({ c: count() }).from(publishEvents)
      .where(gt(publishEvents.created_at, new Date(Date.now() - 864e5).toISOString()))),
    mrr,
    plan_distribution: await db.select({ plan_tier: organizations.plan_tier, c: count() })
      .from(organizations).groupBy(organizations.plan_tier),
    uptime_seconds: Math.round(process.uptime()),
    memory_mb: Math.round(process.memoryUsage().rss / 1e6),
    // A paired screen that is offline is the alert an operator acts on.
    alerts: await one(db.select({ c: count() }).from(screens)
      .where(and(eq(screens.status, 'offline'), isNotNull(screens.device_token)))),
    // What this node is actually wired to — the first thing to check when a publish
    // does not land or renditions stop appearing.
    infrastructure: {
      node_id: bus.NODE_ID,
      database: 'postgres',
      db_pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
      bus: bus.driver(),
      storage: storageDriver(),
      transcode: await queueStats(),
    },
  });
});

superadmin.get('/admin/audit', async (c) =>
  c.json(await db.select().from(auditLogs).orderBy(desc(auditLogs.created_at)).limit(300)));

/** Run every timer now, for support and for the tests. */
superadmin.post('/admin/jobs/run', async (c) => {
  const republished = await schedulerTick();
  await healthTick();
  await billingTick();
  const requeued = await reclaimStale();
  return c.json({ ok: true, republished, transcode_requeued: requeued });
});
