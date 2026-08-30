// SOT: plans, plan-limits, feature-gates, usage
// WHAT:  the commercial shape of the product — what each tier costs and allows.
// WHY:   one table drives pricing, the upgrade prompts, the limit checks and the
//        feature gates, so they cannot disagree with each other.
// WHERE: enforced in src/routes/; billed in src/lib/billing.ts

import { and, count, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { screens, users } from '../db/schema.js';
import type { Organization } from '../db/schema.js';
import type { Middleware } from './http.js';

export type PlanTier = 'trial' | 'starter' | 'growth' | 'enterprise';

export type Plan = {
  name: string;
  /** Per screen, per month, in the tenant's currency's major unit. */
  price_per_screen: number;
  max_screens: number;
  max_users: number;
  features: readonly string[];
};

export const PLANS: Record<PlanTier, Plan> = {
  trial:      { name: 'Free Trial', price_per_screen: 0,   max_screens: 3,     max_users: 3,    features: ['pairing', 'playlists', 'ticker'] },
  starter:    { name: 'Starter',    price_per_screen: 499, max_screens: 10,    max_users: 5,    features: ['pairing', 'playlists', 'ticker', 'monitoring'] },
  growth:     { name: 'Growth',     price_per_screen: 399, max_screens: 100,   max_users: 25,   features: ['pairing', 'playlists', 'ticker', 'monitoring', 'scheduling', 'rbac', 'analytics'] },
  enterprise: { name: 'Enterprise', price_per_screen: 299, max_screens: 10000, max_users: 1000, features: ['pairing', 'playlists', 'ticker', 'monitoring', 'scheduling', 'rbac', 'analytics', 'sso', 'approval', 'residency'] },
};

export const isPlanTier = (v: unknown): v is PlanTier =>
  typeof v === 'string' && v in PLANS;

export const planOf = (org: Organization): Plan =>
  PLANS[org.plan_tier as PlanTier] ?? PLANS.trial;

export type Usage = { screens: number; users: number };

export async function usage(orgId: string): Promise<Usage> {
  const [screenRow] = await db.select({ c: count() }).from(screens).where(eq(screens.org_id, orgId));
  const [userRow] = await db.select({ c: count() }).from(users)
    .where(and(eq(users.org_id, orgId), eq(users.status, 'active')));
  return { screens: screenRow?.c ?? 0, users: userRow?.c ?? 0 };
}

export type LimitResult =
  | { ok: true }
  | { ok: false; error: string; limit: number; plan: string };

export async function limitCheck(org: Organization, kind: 'screen' | 'user'): Promise<LimitResult> {
  const plan = planOf(org);
  const u = await usage(org.id);
  if (kind === 'screen' && u.screens >= plan.max_screens)
    return { ok: false, error: 'screen_limit_reached', limit: plan.max_screens, plan: org.plan_tier };
  if (kind === 'user' && u.users >= plan.max_users)
    return { ok: false, error: 'user_limit_reached', limit: plan.max_users, plan: org.plan_tier };
  return { ok: true };
}

/** A per-org flag overrides the plan, which is how a feature is rolled out early. */
export function hasFeature(org: Organization, feature: string): boolean {
  const flags = JSON.parse(org.feature_flags || '{}') as Record<string, boolean>;
  if (feature in flags) return !!flags[feature];
  return planOf(org).features.includes(feature);
}

/** 402, not 403: the caller is allowed, the plan is what is missing. */
export const requireFeature = (feature: string): Middleware => async (c, next) => {
  const org = c.get('org');
  if (!org) return c.json({ error: 'unauthorized' }, 401);
  if (!hasFeature(org, feature))
    return c.json({ error: 'feature_not_in_plan', feature, plan: org.plan_tier }, 402);
  await next();
};
