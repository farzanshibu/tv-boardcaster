// SOT: billing-api, subscribe, checkout, invoices, gateway-webhooks
// WHAT:  the tenant's commercial surface, and the endpoints the gateways call back.
// WHY:   with a gateway configured, /billing/subscribe must not activate anything —
//        it only opens a hosted checkout. The plan changes when a signed webhook says
//        the money moved, so a caller cannot upgrade itself by posting to the API.
// WHERE: gateway adapters and the state machine in src/lib/billing.ts

import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { invoices, notifications, organizations, subscriptions } from '../db/schema.js';
import { audit, auditActor, requireAuth, requirePerm } from '../lib/auth.js';
import {
  GATEWAYS, activeGateway, applyBillingEvent, createCheckout, gatewayConfigured, isGateway,
  priceFor, verifyWebhook,
} from '../lib/billing.js';
import type { AppEnv } from '../lib/http.js';
import { now, uid } from '../lib/ids.js';
import { generateInvoice } from '../lib/jobs.js';
import { PLANS, isPlanTier, planOf, usage } from '../lib/plans.js';
import { jsonBody } from '../lib/ratelimit.js';

export const billing = new Hono<AppEnv>();

billing.get('/billing', requireAuth, async (c) => {
  const orgId = c.get('orgId');
  const org = c.get('org');
  if (!org) return c.json({ error: 'unauthorized' }, 401);
  const sub = await db.query.subscriptions.findFirst({ where: eq(subscriptions.org_id, orgId) });
  const u = await usage(orgId);
  const plan = planOf(org);

  return c.json({
    subscription: sub ?? null,
    plan,
    usage: u,
    plans: PLANS,
    gateway: activeGateway(),
    // Warn before the wall, not at it.
    near_limit: u.screens >= plan.max_screens * 0.8 || u.users >= plan.max_users * 0.8,
    estimated_next_invoice: {
      currency: org.country === 'IN' ? 'INR' : 'USD',
      subtotal: plan.price_per_screen * u.screens,
      tax: org.country === 'IN' ? Math.round(plan.price_per_screen * u.screens * 0.18) : 0,
    },
    invoices: await db.select().from(invoices)
      .where(eq(invoices.org_id, orgId)).orderBy(desc(invoices.created_at)),
  });
});

/**
 * Subscribe or change plan.
 * With a gateway configured this only starts a hosted checkout — the plan changes
 * when the signed webhook confirms payment, never on the strength of this request.
 * On `manual` (no keys: self-hosted or demo) the change applies here.
 */
billing.post('/billing/subscribe', requireAuth, requirePerm('billing:write'), async (c) => {
  const orgId = c.get('orgId');
  const org = c.get('org');
  if (!org) return c.json({ error: 'unauthorized' }, 401);

  const body = await jsonBody(c);
  const plan = String(body.plan ?? '');
  const billingCycle = String(body.billing_cycle ?? 'monthly');
  const paymentMethod = String(body.payment_method ?? 'card');
  const requested = body.gateway === undefined ? undefined : String(body.gateway);

  if (!isPlanTier(plan)) return c.json({ error: 'unknown_plan', plans: Object.keys(PLANS) }, 400);
  if (!['monthly', 'yearly'].includes(billingCycle)) return c.json({ error: 'bad_cycle' }, 400);
  if (requested !== undefined && !isGateway(requested))
    return c.json({ error: 'unknown_gateway', gateways: GATEWAYS }, 400);

  const u = await usage(orgId);
  // Downgrading below the screens already paired would silently orphan them.
  if (u.screens > PLANS[plan].max_screens) {
    return c.json({
      error: 'downgrade_blocked_screen_count',
      screens: u.screens, limit: PLANS[plan].max_screens,
    }, 400);
  }

  const sub = await db.query.subscriptions.findFirst({ where: eq(subscriptions.org_id, orgId) });
  if (!sub) return c.json({ error: 'no_subscription' }, 404);

  // A caller may pick between gateways this deployment has keys for. It cannot pick
  // one there are no keys for, and it cannot ask for `manual` to skip paying.
  const live = requested && isGateway(requested) && gatewayConfigured(requested)
    ? requested
    : activeGateway();

  if (live !== 'manual') {
    let checkout;
    try {
      checkout = await createCheckout({
        org, plan, cycle: billingCycle, screens: u.screens, gateway: live,
      });
    } catch (err) {
      // 502: the gateway failed, not the caller.
      return c.json({ error: 'gateway_error', detail: (err as Error).message }, 502);
    }
    if (!checkout) return c.json({ error: 'gateway_error', detail: 'no_checkout' }, 502);

    await db.update(subscriptions).set({ gateway: live }).where(eq(subscriptions.id, sub.id));
    await audit(auditActor(c), 'billing.checkout', orgId,
      { plan, billing_cycle: billingCycle, gateway: live, reference: checkout.reference });
    return c.json({
      ok: true,
      pending: true,
      gateway: live,
      checkout_url: checkout.checkout_url,
      reference: checkout.reference,
      amount: priceFor(plan, billingCycle, u.screens),
      subscription: await db.query.subscriptions.findFirst({ where: eq(subscriptions.id, sub.id) }),
    });
  }

  // Manual: no gateway is wired up, so the operator is recording a settlement made
  // elsewhere. `payment_method` is that record, not a claim this service took a card.
  const renews = new Date(
    Date.now() + (billingCycle === 'yearly' ? 365 : 30) * 864e5,
  ).toISOString();
  const recordedAs = `${requested ?? 'manual'}:${paymentMethod}`;

  await db.transaction(async (tx) => {
    await tx.update(subscriptions).set({
      plan, billing_cycle: billingCycle, status: 'active',
      payment_method: recordedAs, screen_count: u.screens, renews_at: renews, gateway: 'manual',
    }).where(eq(subscriptions.id, sub.id));
    await tx.update(organizations).set({ plan_tier: plan }).where(eq(organizations.id, orgId));
  });
  await audit(auditActor(c), 'billing.subscribe', orgId,
    { plan, billing_cycle: billingCycle, gateway: 'manual', recorded_as: recordedAs });

  const freshOrg = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
  const freshSub = await db.query.subscriptions.findFirst({ where: eq(subscriptions.id, sub.id) });
  const invoice = freshOrg && freshSub ? await generateInvoice(freshOrg, freshSub) : null;
  await db.insert(notifications).values({
    id: uid('ntf'), org_id: orgId, kind: 'billing',
    message: `Subscribed to ${PLANS[plan].name} (${billingCycle})`, read: 0, created_at: now(),
  });

  return c.json({
    ok: true,
    subscription: await db.query.subscriptions.findFirst({ where: eq(subscriptions.id, sub.id) }),
    invoice,
  });
});

billing.post('/billing/cancel', requireAuth, requirePerm('billing:write'), async (c) => {
  await db.update(subscriptions).set({ status: 'canceled' })
    .where(eq(subscriptions.org_id, c.get('orgId')));
  await audit(auditActor(c), 'billing.cancel', c.get('orgId'));
  return c.json({ ok: true });
});

billing.get('/billing/invoices/:id', requireAuth, async (c) => {
  const org = c.get('org');
  if (!org) return c.json({ error: 'unauthorized' }, 401);
  const inv = await db.query.invoices.findFirst({
    where: and(eq(invoices.id, c.req.param('id')), eq(invoices.org_id, org.id)),
  });
  if (!inv) return c.json({ error: 'not_found' }, 404);
  return c.json({
    ...inv,
    bill_to: { organization: org.name, gstin: org.gstin, country: org.country },
    issuer: { name: 'Brandcast TV', gstin: process.env.ISSUER_GSTIN || '29AABCB1234C1ZX' },
    line_items: [{
      description: `${PLANS[inv.plan as keyof typeof PLANS]?.name ?? inv.plan} - ${inv.screens} screen(s)`,
      amount: inv.subtotal,
    }],
  });
});

/* ================= gateway webhooks ================= */

/**
 * Unauthenticated by design: the signature over the raw body is the credential, so
 * the body is read as text and verified before it is parsed or acted on. A gateway
 * retries until it gets a 2xx, and a replay of an event already applied answers 200
 * rather than applying it twice.
 */
billing.post('/billing/webhooks/:gateway', async (c) => {
  const gateway = c.req.param('gateway').toLowerCase();
  if (!['stripe', 'razorpay'].includes(gateway)) return c.json({ error: 'unknown_gateway' }, 404);

  const raw = await c.req.text();
  const headers: Record<string, string | undefined> = {
    'stripe-signature': c.req.header('stripe-signature'),
    'x-razorpay-signature': c.req.header('x-razorpay-signature'),
    'x-razorpay-event-id': c.req.header('x-razorpay-event-id'),
  };

  let event;
  try {
    event = verifyWebhook(gateway, raw, headers);
  } catch (err) {
    // 400, not 500: a bad signature is the caller's problem and must not be retried.
    console.warn(`[billing] rejected ${gateway} webhook: ${(err as Error).message}`);
    return c.json({ error: 'invalid_signature', detail: (err as Error).message }, 400);
  }

  try {
    return c.json({ ok: true, ...(await applyBillingEvent(event)) });
  } catch (err) {
    // 500 so the gateway retries: the event was authentic, we failed to apply it.
    console.error('[billing] webhook apply failed', err);
    return c.json({ error: 'webhook_processing_failed' }, 500);
  }
});
