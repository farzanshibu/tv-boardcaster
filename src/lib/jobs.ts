// SOT: background-jobs, scheduler-tick, health-tick, billing-tick, invoices
// WHAT:  the three timers that keep screens current, flag dead ones, and bill.
// WHY:   dayparting has to rotate without anyone pressing publish, and a screen that
//        stops calling home has to be visible as offline before someone walks past it.
// HOW:   each tick is idempotent and skips a beat rather than piling up when it runs
//        long. The scheduler compares a fingerprint of the resolved payload, so it
//        republishes only when the content actually changed.
// WHERE: content resolution in src/lib/content.ts; delivery in src/lib/hub.ts

import { count, eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { invoices, notifications, organizations, screens, subscriptions } from '../db/schema.js';
import type { Invoice, Organization, Subscription } from '../db/schema.js';
import * as bus from './bus.js';
import { buildPayload, publishToScreen, type ScreenPayload } from './content.js';
import * as hub from './hub.js';
import { now, uid } from './ids.js';
import { PLANS, type PlanTier } from './plans.js';

/** screen_id -> fingerprint of the last payload we saw for it. */
const lastPayload = new Map<string, string>();

/** Everything a screen would notice a change in. */
const fingerprint = (p: ScreenPayload): string => JSON.stringify({
  pl: p.playlist?.id ?? null,
  items: (p.playlist?.items ?? []).map((i) => [i.media_id, i.duration]),
  tk: p.ticker ? [p.ticker.id, p.ticker.text, p.ticker.position] : null,
});

/** Re-publish screens whose scheduled content changed (daypart rotation, expiry). */
export async function schedulerTick(): Promise<number> {
  const paired = await db.select().from(screens).where(isNotNull(screens.device_token));
  let changed = 0;
  for (const s of paired) {
    const fp = fingerprint(await buildPayload(s));
    if (lastPayload.get(s.id) === fp) continue;
    // The first pass only records the baseline: a restart must not republish the
    // whole fleet just because this map started empty.
    if (lastPayload.has(s.id)) { await publishToScreen(s, { source: 'schedule' }); changed++; }
    lastPayload.set(s.id, fp);
  }
  return changed;
}

const OFFLINE_AFTER_MS = Number(process.env.OFFLINE_AFTER_MS ?? 90_000);

/**
 * Mark stale screens offline and raise alerts.
 * On one node a live socket is proof of life. Across a fleet it is not — the socket
 * may be parked on a sibling — so the shared heartbeat column is the only signal
 * every node agrees on.
 */
export async function healthTick(): Promise<void> {
  const paired = await db.select().from(screens).where(isNotNull(screens.device_token));
  for (const s of paired) {
    const stale = !s.last_seen_at || (Date.now() - Date.parse(s.last_seen_at)) > OFFLINE_AFTER_MS;
    const live = bus.distributed() ? !stale : hub.isConnectedLocally(s.id) && !stale;
    const shouldBe = live ? 'online' : 'offline';
    if (shouldBe === s.status) continue;

    await db.update(screens).set({ status: shouldBe }).where(eq(screens.id, s.id));
    await hub.logStatus(s, shouldBe);
    await hub.broadcastDashboard(s.org_id, { type: 'screen_status', screen_id: s.id, status: shouldBe });
    await db.insert(notifications).values({
      id: uid('ntf'),
      org_id: s.org_id,
      kind: shouldBe === 'offline' ? 'screen_offline' : 'screen_online',
      message: `Screen "${s.name}" is ${shouldBe}`,
      read: 0,
      created_at: now(),
    });
  }
}

/** Monthly invoice generation for subscriptions past their renewal date. */
export async function billingTick(): Promise<void> {
  const due = await db.select().from(subscriptions)
    .where(inArray(subscriptions.status, ['active', 'trialing']));
  for (const sub of due) {
    if (!sub.renews_at || Date.parse(sub.renews_at) > Date.now()) continue;
    if (sub.status === 'trialing') {
      await db.update(subscriptions).set({ status: 'past_due' }).where(eq(subscriptions.id, sub.id));
      continue;
    }
    // A gateway-managed subscription is invoiced by the gateway, and its webhook
    // writes the row. Generating one here would bill the tenant twice on paper.
    if (sub.gateway && sub.gateway !== 'manual') continue;
    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, sub.org_id) });
    if (org) await generateInvoice(org, sub);
  }
}

export type InvoiceOverrides = {
  /** What the gateway actually charged, in major units. */
  subtotal?: number;
  currency?: string;
  status?: string;
  gateway_invoice_id?: string;
};

/** Write an invoice and roll the subscription's renewal date forward. */
export async function generateInvoice(
  org: Organization, sub: Subscription, extra: InvoiceOverrides = {},
): Promise<Invoice | undefined> {
  const plan = PLANS[sub.plan as PlanTier] ?? PLANS.trial;
  const [screenRow] = await db.select({ c: count() }).from(screens).where(eq(screens.org_id, org.id));
  const billableScreens = screenRow?.c ?? 0;
  // A yearly commitment is twelve months less 15%.
  const months = sub.billing_cycle === 'yearly' ? 12 * 0.85 : 1;
  const subtotal = extra.subtotal ?? Math.round(plan.price_per_screen * billableScreens * months);
  const taxRate = org.country === 'IN' ? 0.18 : 0;
  const tax = Math.round(subtotal * taxRate);
  const periodEnd = new Date(
    Date.now() + (sub.billing_cycle === 'yearly' ? 365 : 30) * 864e5,
  ).toISOString();

  const id = uid('inv');
  const [invoice] = await db.insert(invoices).values({
    id,
    org_id: org.id,
    number: `BC-${new Date().getFullYear()}-${id.slice(-6).toUpperCase()}`,
    plan: sub.plan,
    screens: billableScreens,
    currency: extra.currency ?? (org.country === 'IN' ? 'INR' : 'USD'),
    subtotal,
    tax,
    tax_label: taxRate ? 'GST 18%' : 'No tax',
    total: subtotal + tax,
    status: extra.status ?? 'paid',
    period_start: now(),
    period_end: periodEnd,
    gateway: sub.gateway ?? null,
    gateway_invoice_id: extra.gateway_invoice_id ?? null,
    created_at: now(),
  }).returning();

  await db.update(subscriptions)
    .set({ screen_count: billableScreens, renews_at: periodEnd })
    .where(eq(subscriptions.id, sub.id));
  return invoice;
}

/** An interval that skips a beat rather than piling up when a tick runs long. */
function every(ms: number, fn: () => Promise<unknown>, label: string): NodeJS.Timeout {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void fn()
      .catch((err: Error) => console.error(`[jobs:${label}]`, err.message))
      .finally(() => { running = false; });
  }, ms);
  timer.unref?.();
  return timer;
}

export function startJobs(): () => void {
  const timers = [
    every(Number(process.env.SCHEDULER_MS ?? 15_000), schedulerTick, 'scheduler'),
    every(Number(process.env.HEALTH_MS ?? 30_000), healthTick, 'health'),
    every(60 * 60 * 1000, billingTick, 'billing'),
  ];
  return () => timers.forEach((t) => clearInterval(t));
}
