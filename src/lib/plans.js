import { db } from './db.js';

export const PLANS = {
  trial:      { name: 'Free Trial', price_per_screen: 0,    max_screens: 3,    max_users: 3,   features: ['pairing', 'playlists', 'ticker'] },
  starter:    { name: 'Starter',    price_per_screen: 499,  max_screens: 10,   max_users: 5,   features: ['pairing', 'playlists', 'ticker', 'monitoring'] },
  growth:     { name: 'Growth',     price_per_screen: 399,  max_screens: 100,  max_users: 25,  features: ['pairing', 'playlists', 'ticker', 'monitoring', 'scheduling', 'rbac', 'analytics'] },
  enterprise: { name: 'Enterprise', price_per_screen: 299,  max_screens: 10000, max_users: 1000, features: ['pairing', 'playlists', 'ticker', 'monitoring', 'scheduling', 'rbac', 'analytics', 'sso', 'approval', 'residency'] },
};

export const planOf = (org) => PLANS[org.plan_tier] || PLANS.trial;

export function usage(orgId) {
  const screens = db.prepare('SELECT COUNT(*) c FROM screens WHERE org_id = ?').get(orgId).c;
  const users = db.prepare("SELECT COUNT(*) c FROM users WHERE org_id = ? AND status='active'").get(orgId).c;
  return { screens, users };
}

export function limitCheck(org, kind) {
  const plan = planOf(org);
  const u = usage(org.id);
  if (kind === 'screen' && u.screens >= plan.max_screens)
    return { ok: false, error: 'screen_limit_reached', limit: plan.max_screens, plan: org.plan_tier };
  if (kind === 'user' && u.users >= plan.max_users)
    return { ok: false, error: 'user_limit_reached', limit: plan.max_users, plan: org.plan_tier };
  return { ok: true };
}

export function hasFeature(org, feature) {
  const flags = JSON.parse(org.feature_flags || '{}');
  if (feature in flags) return !!flags[feature];
  return planOf(org).features.includes(feature);
}

export const requireFeature = (feature) => (req, res, next) =>
  hasFeature(req.org, feature) ? next() : res.status(402).json({ error: 'feature_not_in_plan', feature, plan: req.org.plan_tier });
