// SOT: billing-gateway, stripe-webhook, razorpay-webhook, checkout, webhook-idempotency
// WHAT:  the payment gateway boundary — checkout creation, webhook verification and
//        the subscription state machine those webhooks drive.
// WHY:   a card charge is not something the API can confirm inline. The gateway owns
//        the money and reports asynchronously, so a subscription only becomes active
//        when a signed webhook says it did. No card data ever reaches this service.
// HOW:   one shape per gateway: createCheckout() returns a URL to send the customer
//        to, verifyWebhook() authenticates a callback and normalises it to an internal
//        event, applyBillingEvent() is the only writer of subscription state. Webhooks
//        are at-least-once, so every event id is recorded before it is applied.
// WHERE: routes in src/routes/billing.ts; invoice rows in src/lib/jobs.ts

import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { notifications, organizations, subscriptions, webhookEvents } from '../db/schema.js';
import type { Organization, Subscription } from '../db/schema.js';
import { generateInvoice } from './jobs.js';
import { now, uid } from './ids.js';
import { PLANS, isPlanTier, type PlanTier } from './plans.js';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';
const PUBLIC_URL = (process.env.PUBLIC_BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
/** A signed timestamp older than this is a replay, not a late delivery. */
const SIGNATURE_TOLERANCE_S = Number(process.env.WEBHOOK_TOLERANCE_S ?? 300);

export const GATEWAYS = ['manual', 'stripe', 'razorpay'] as const;
export type Gateway = (typeof GATEWAYS)[number];
export const isGateway = (v: unknown): v is Gateway => GATEWAYS.includes(v as Gateway);

/**
 * Which gateway is live. Without keys the service stays on `manual`, where a
 * subscribe call takes effect immediately — the self-hosted and demo path, not a
 * way to skip paying in production.
 */
export function activeGateway(): Gateway {
  const forced = (process.env.BILLING_GATEWAY || '').toLowerCase();
  if (isGateway(forced)) return forced;
  if (STRIPE_SECRET_KEY) return 'stripe';
  if (RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) return 'razorpay';
  return 'manual';
}

export const gatewayConfigured = (g: Gateway): boolean =>
  (g === 'stripe' && !!STRIPE_SECRET_KEY) ||
  (g === 'razorpay' && !!(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET));

export type Price = { major: number; minor: number };

/** Gateways bill in the smallest unit: paise, cents. */
export function priceFor(plan: string, cycle: string, screens: number): Price | null {
  if (!isPlanTier(plan)) return null;
  const months = cycle === 'yearly' ? 12 * 0.85 : 1;
  const major = Math.round(PLANS[plan].price_per_screen * Math.max(1, screens) * months);
  return { major, minor: major * 100 };
}

/* ------------------------------------------------------------------ *
 * Checkout
 * ------------------------------------------------------------------ */

/** Stripe takes bracketed form encoding, not JSON. */
function formEncode(obj: unknown, prefix = '', out = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') formEncode(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export type Checkout = { checkout_url: string; reference: string; gateway: Gateway };

type CheckoutArgs = {
  org: Organization; plan: PlanTier; cycle: string; screens: number;
  currency: string; price: Price;
};

async function stripeCheckout({ org, plan, cycle, screens, currency, price }: CheckoutArgs): Promise<Checkout> {
  const body = formEncode({
    mode: 'subscription',
    success_url: `${PUBLIC_URL}/dashboard/billing?checkout=success`,
    cancel_url: `${PUBLIC_URL}/dashboard/billing?checkout=cancelled`,
    client_reference_id: org.id,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: currency.toLowerCase(),
        unit_amount: price.minor,
        recurring: { interval: cycle === 'yearly' ? 'year' : 'month' },
        product_data: { name: `Brandcast TV ${PLANS[plan].name} — ${screens} screen(s)` },
      },
    }],
    // The org id has to survive the round trip through Stripe: it is how the webhook
    // finds the tenant when it comes back minutes later.
    metadata: { org_id: org.id, plan, billing_cycle: cycle },
    subscription_data: { metadata: { org_id: org.id, plan, billing_cycle: cycle } },
  });

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      // A retried request must not open a second session against the same card.
      'Idempotency-Key': `co_${org.id}_${plan}_${cycle}_${Math.floor(Date.now() / 60000)}`,
    },
    body,
  });
  const json = await res.json() as { url?: string; id?: string; error?: { message?: string } };
  if (!res.ok || !json.url) throw new Error(json.error?.message ?? `stripe_checkout_failed:${res.status}`);
  return { checkout_url: json.url, reference: json.id ?? '', gateway: 'stripe' };
}

async function razorpayCheckout({ org, plan, cycle, screens, currency, price }: CheckoutArgs): Promise<Checkout> {
  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
  const notes = { org_id: org.id, plan, billing_cycle: cycle };

  // Razorpay subscriptions bill against a plan created in their dashboard. When one
  // is configured we use it; otherwise a payment link collects the same amount once.
  const planId = process.env[`RAZORPAY_PLAN_${plan.toUpperCase()}_${cycle.toUpperCase()}`];
  const endpoint = planId
    ? 'https://api.razorpay.com/v1/subscriptions'
    : 'https://api.razorpay.com/v1/payment_links';
  const payload = planId
    ? { plan_id: planId, total_count: cycle === 'yearly' ? 5 : 60, quantity: 1, customer_notify: 1, notes }
    : {
        amount: price.minor,
        currency,
        description: `Brandcast TV ${PLANS[plan].name} — ${screens} screen(s)`,
        notify: { email: true },
        reminder_enable: true,
        notes,
        callback_url: `${PUBLIC_URL}/dashboard/billing?checkout=success`,
        callback_method: 'get',
      };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json() as { short_url?: string; id?: string; error?: { description?: string } };
  if (!res.ok || !json.short_url) {
    throw new Error(json.error?.description ?? `razorpay_checkout_failed:${res.status}`);
  }
  return { checkout_url: json.short_url, reference: json.id ?? '', gateway: 'razorpay' };
}

/**
 * Start a hosted checkout. Returns null on `manual`, which tells the caller to apply
 * the plan change directly.
 */
export async function createCheckout(
  { org, plan, cycle, screens, gateway }: {
    org: Organization; plan: PlanTier; cycle: string; screens: number; gateway?: Gateway;
  },
): Promise<Checkout | null> {
  const live = gateway ?? activeGateway();
  if (live === 'manual') return null;
  const currency = org.country === 'IN' ? 'INR' : 'USD';
  const price = priceFor(plan, cycle, screens);
  if (!price) throw new Error('unknown_plan');
  const args: CheckoutArgs = { org, plan, cycle, screens, currency, price };
  return live === 'stripe' ? stripeCheckout(args) : razorpayCheckout(args);
}

/* ------------------------------------------------------------------ *
 * Webhook verification
 * ------------------------------------------------------------------ */

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * Stripe signs `${timestamp}.${rawBody}`. The timestamp is inside the signed data,
 * so checking it against the clock is what stops a captured request being replayed.
 */
export function verifyStripeSignature(
  rawBody: string, header: string | undefined, secret = STRIPE_WEBHOOK_SECRET,
): true {
  if (!secret) throw new Error('stripe_webhook_secret_not_set');
  const parts = Object.fromEntries(
    String(header ?? '').split(',')
      .map((p) => p.split('=', 2))
      .filter((p): p is [string, string] => p.length === 2),
  );
  const timestamp = Number(parts.t);
  if (!timestamp || !parts.v1) throw new Error('malformed_signature');
  if (Math.abs(Date.now() / 1000 - timestamp) > SIGNATURE_TOLERANCE_S) throw new Error('signature_too_old');
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  if (!safeEqual(expected, parts.v1)) throw new Error('signature_mismatch');
  return true;
}

/** Razorpay signs the raw body alone. */
export function verifyRazorpaySignature(
  rawBody: string, header: string | undefined, secret = RAZORPAY_WEBHOOK_SECRET,
): true {
  if (!secret) throw new Error('razorpay_webhook_secret_not_set');
  if (!header) throw new Error('malformed_signature');
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  if (!safeEqual(expected, header)) throw new Error('signature_mismatch');
  return true;
}

/* ------------------------------------------------------------------ *
 * Event normalisation
 * ------------------------------------------------------------------ */

export type BillingEventType =
  | 'subscription.active'
  | 'subscription.updated'
  | 'subscription.past_due'
  | 'subscription.canceled'
  | 'invoice.paid'
  | 'ignored';

export type BillingEvent = {
  id: string;
  gateway: Gateway;
  type: BillingEventType;
  raw_type: string;
  org_id: string | null;
  plan: string | null;
  billing_cycle: string | null;
  gateway_customer_id: string | null;
  gateway_subscription_id: string | null;
  gateway_invoice_id: string | null;
  status: string | null;
  cancel_at_period_end: number;
  amount_minor: number | null;
  currency: string | null;
  period_end: string | null;
};

const STRIPE_MAP: Record<string, BillingEventType> = {
  'checkout.session.completed': 'subscription.active',
  'customer.subscription.created': 'subscription.active',
  'customer.subscription.updated': 'subscription.updated',
  'customer.subscription.deleted': 'subscription.canceled',
  'invoice.paid': 'invoice.paid',
  'invoice.payment_succeeded': 'invoice.paid',
  'invoice.payment_failed': 'subscription.past_due',
};

const RAZORPAY_MAP: Record<string, BillingEventType> = {
  'subscription.activated': 'subscription.active',
  'subscription.charged': 'invoice.paid',
  'subscription.updated': 'subscription.updated',
  'subscription.halted': 'subscription.past_due',
  'subscription.pending': 'subscription.past_due',
  'subscription.cancelled': 'subscription.canceled',
  'payment_link.paid': 'subscription.active',
  'payment.failed': 'subscription.past_due',
};

const STRIPE_STATUS: Record<string, string> = {
  active: 'active', trialing: 'active', past_due: 'past_due',
  unpaid: 'past_due', canceled: 'canceled', incomplete_expired: 'canceled',
};

type StripeObject = {
  object?: string;
  id?: string;
  status?: string;
  metadata?: Record<string, string>;
  subscription_details?: { metadata?: Record<string, string> };
  client_reference_id?: string;
  customer?: string | { id?: string };
  subscription?: string | { id?: string };
  cancel_at_period_end?: boolean;
  amount_paid?: number;
  amount_total?: number;
  currency?: string;
  current_period_end?: number;
};

function normalizeStripe(event: { id?: string; type?: string; data?: { object?: StripeObject } }): BillingEvent {
  const o = event.data?.object ?? {};
  const meta = { ...(o.metadata ?? {}), ...(o.subscription_details?.metadata ?? {}) };
  const customer = typeof o.customer === 'string' ? o.customer : o.customer?.id ?? null;
  const subscription = typeof o.subscription === 'string'
    ? o.subscription
    : o.subscription?.id ?? (o.object === 'subscription' ? o.id ?? null : null);
  return {
    id: event.id ?? '',
    gateway: 'stripe',
    type: STRIPE_MAP[event.type ?? ''] ?? 'ignored',
    raw_type: event.type ?? '',
    org_id: meta.org_id ?? o.client_reference_id ?? null,
    plan: meta.plan ?? null,
    billing_cycle: meta.billing_cycle ?? null,
    gateway_customer_id: customer,
    gateway_subscription_id: subscription,
    gateway_invoice_id: o.object === 'invoice' ? o.id ?? null : null,
    status: STRIPE_STATUS[o.status ?? ''] ?? null,
    cancel_at_period_end: o.cancel_at_period_end ? 1 : 0,
    amount_minor: o.amount_paid ?? o.amount_total ?? null,
    currency: o.currency ? o.currency.toUpperCase() : null,
    period_end: o.current_period_end ? new Date(o.current_period_end * 1000).toISOString() : null,
  };
}

const RAZORPAY_STATUS: Record<string, string> = {
  active: 'active', authenticated: 'active', halted: 'past_due',
  pending: 'past_due', cancelled: 'canceled', completed: 'canceled',
};

type RazorpayEntity = {
  id?: string; status?: string; currency?: string; customer_id?: string;
  notes?: Record<string, string>; amount?: number; invoice_id?: string; current_end?: number;
};

function normalizeRazorpay(event: {
  event?: string;
  created_at?: number;
  __event_id?: string;
  payload?: {
    subscription?: { entity?: RazorpayEntity };
    payment?: { entity?: RazorpayEntity };
    payment_link?: { entity?: RazorpayEntity };
  };
}): BillingEvent {
  const sub = event.payload?.subscription?.entity;
  const payment = event.payload?.payment?.entity;
  const link = event.payload?.payment_link?.entity;
  const entity = sub ?? link ?? payment ?? {};
  const notes = entity.notes ?? {};
  return {
    // Razorpay's delivery id arrives in a header; the route passes it in. Without it,
    // the event name plus the entity id is still stable enough to dedupe on.
    id: event.__event_id ?? `${event.event ?? ''}:${entity.id ?? ''}:${event.created_at ?? ''}`,
    gateway: 'razorpay',
    type: RAZORPAY_MAP[event.event ?? ''] ?? 'ignored',
    raw_type: event.event ?? '',
    org_id: notes.org_id ?? null,
    plan: notes.plan ?? null,
    billing_cycle: notes.billing_cycle ?? null,
    gateway_customer_id: entity.customer_id ?? null,
    gateway_subscription_id: sub?.id ?? null,
    gateway_invoice_id: payment?.invoice_id ?? link?.id ?? null,
    status: RAZORPAY_STATUS[sub?.status ?? ''] ?? null,
    cancel_at_period_end: 0,
    amount_minor: payment?.amount ?? link?.amount ?? null,
    currency: entity.currency ? entity.currency.toUpperCase() : null,
    period_end: sub?.current_end ? new Date(sub.current_end * 1000).toISOString() : null,
  };
}

/**
 * Authenticate a raw webhook body and turn it into one internal event.
 * Throws when the signature does not check out — the body must not be parsed and
 * acted on before that.
 */
export function verifyWebhook(
  gateway: string, rawBody: string | Buffer, headers: Record<string, string | undefined> = {},
): BillingEvent {
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody ?? '');
  if (gateway === 'stripe') {
    verifyStripeSignature(body, headers['stripe-signature']);
    return normalizeStripe(JSON.parse(body));
  }
  if (gateway === 'razorpay') {
    verifyRazorpaySignature(body, headers['x-razorpay-signature']);
    const parsed = JSON.parse(body) as Parameters<typeof normalizeRazorpay>[0];
    if (headers['x-razorpay-event-id']) parsed.__event_id = headers['x-razorpay-event-id'];
    return normalizeRazorpay(parsed);
  }
  throw new Error('unknown_gateway');
}

/* ------------------------------------------------------------------ *
 * State machine
 * ------------------------------------------------------------------ */

/** The tenant an event belongs to: its own metadata first, then the gateway ids. */
async function resolveSubscription(event: BillingEvent): Promise<Subscription | undefined> {
  if (event.org_id) {
    const byOrg = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.org_id, event.org_id),
    });
    if (byOrg) return byOrg;
  }
  if (event.gateway_subscription_id) {
    const bySub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.gateway_subscription_id, event.gateway_subscription_id),
    });
    if (bySub) return bySub;
  }
  if (event.gateway_customer_id) {
    return db.query.subscriptions.findFirst({
      where: eq(subscriptions.gateway_customer_id, event.gateway_customer_id),
    });
  }
  return undefined;
}

export type ApplyResult =
  | { ignored: true; raw_type: string }
  | { unmatched: true; raw_type: string }
  | { duplicate: true; org_id: string }
  | { ok: true; org_id: string; applied: BillingEventType };

/**
 * Record the event and apply it. Returns `{ duplicate: true }` when the gateway is
 * redelivering something already handled, which is the normal at-least-once case.
 */
export async function applyBillingEvent(event: BillingEvent): Promise<ApplyResult> {
  if (event.type === 'ignored') return { ignored: true, raw_type: event.raw_type };

  const sub = await resolveSubscription(event);
  if (!sub) return { unmatched: true, raw_type: event.raw_type };

  const seen = await db.query.webhookEvents.findFirst({
    where: and(eq(webhookEvents.gateway, event.gateway), eq(webhookEvents.event_id, event.id)),
  });
  if (seen) return { duplicate: true, org_id: sub.org_id };

  await db.insert(webhookEvents).values({
    id: uid('whk'),
    gateway: event.gateway,
    event_id: event.id,
    type: event.raw_type,
    org_id: sub.org_id,
    status: 'processed',
    payload: JSON.stringify(event),
    created_at: now(),
  });

  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, sub.org_id) });
  const plan = event.plan && isPlanTier(event.plan) ? event.plan : sub.plan;
  const cycle = event.billing_cycle ?? sub.billing_cycle;
  const renews = event.period_end
    ?? new Date(Date.now() + (cycle === 'yearly' ? 365 : 30) * 864e5).toISOString();

  /** Only overwrite a gateway id when the event actually carried one. */
  const gatewayIds = () => ({
    gateway: event.gateway,
    ...(event.gateway_customer_id ? { gateway_customer_id: event.gateway_customer_id } : {}),
    ...(event.gateway_subscription_id ? { gateway_subscription_id: event.gateway_subscription_id } : {}),
  });

  switch (event.type) {
    case 'subscription.active': {
      await db.update(subscriptions).set({
        ...gatewayIds(),
        plan, billing_cycle: cycle, status: 'active', renews_at: renews, cancel_at_period_end: 0,
      }).where(eq(subscriptions.id, sub.id));
      await db.update(organizations).set({ plan_tier: plan }).where(eq(organizations.id, sub.org_id));
      await notifyOrg(sub.org_id, 'billing',
        `Subscription active on ${PLANS[plan as PlanTier].name} (${cycle})`);
      break;
    }
    case 'subscription.updated': {
      const status = event.status ?? sub.status;
      await db.update(subscriptions).set({
        ...gatewayIds(),
        plan, billing_cycle: cycle, status, renews_at: renews,
        cancel_at_period_end: event.cancel_at_period_end ? 1 : 0,
      }).where(eq(subscriptions.id, sub.id));
      if (status === 'active') {
        await db.update(organizations).set({ plan_tier: plan }).where(eq(organizations.id, sub.org_id));
      }
      break;
    }
    case 'subscription.past_due': {
      await db.update(subscriptions).set({ status: 'past_due' }).where(eq(subscriptions.id, sub.id));
      await notifyOrg(sub.org_id, 'billing',
        'Payment failed — update your payment method to avoid interruption');
      break;
    }
    case 'subscription.canceled': {
      await db.update(subscriptions).set({ status: 'canceled', cancel_at_period_end: 0 })
        .where(eq(subscriptions.id, sub.id));
      await notifyOrg(sub.org_id, 'billing', 'Subscription cancelled');
      break;
    }
    case 'invoice.paid': {
      await db.update(subscriptions).set({ ...gatewayIds(), status: 'active', renews_at: renews })
        .where(eq(subscriptions.id, sub.id));
      const current = await db.query.subscriptions.findFirst({ where: eq(subscriptions.id, sub.id) });
      if (org && current) {
        await generateInvoice(org, current, {
          // The gateway is the authority on what was actually charged.
          ...(event.amount_minor != null ? { subtotal: Math.round(event.amount_minor / 100) } : {}),
          ...(event.currency ? { currency: event.currency } : {}),
          ...(event.gateway_invoice_id ? { gateway_invoice_id: event.gateway_invoice_id } : {}),
          status: 'paid',
        });
      }
      break;
    }
  }

  return { ok: true, org_id: sub.org_id, applied: event.type };
}

async function notifyOrg(orgId: string, kind: string, message: string): Promise<void> {
  await db.insert(notifications).values({
    id: uid('ntf'), org_id: orgId, kind, message, read: 0, created_at: now(),
  });
}
