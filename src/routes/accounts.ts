// SOT: signup, login, sso, password-reset, 2fa, org-settings, users, invites, branches
// WHAT:  everything about who belongs to a tenant and how they get in.
// WHY:   signup is the only place a tenant comes into existence, so it creates the
//        org, its owner, a trial subscription and a first branch in one transaction —
//        a half-made tenant is worse than a failed signup.
// WHERE: RBAC and tokens in src/lib/auth.ts; plan limits in src/lib/plans.ts

import { Hono } from 'hono';
import { and, asc, count, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { branches, invites, organizations, screens, subscriptions, users } from '../db/schema.js';
import type { User } from '../db/schema.js';
import {
  audit, auditActor, check, hash, isRole, requireAuth, requirePerm, signUser, totpSecret, totpVerify,
} from '../lib/auth.js';
import type { AppEnv, SessionUser } from '../lib/http.js';
import { now, uid } from '../lib/ids.js';
import { PLANS, limitCheck, planOf, usage } from '../lib/plans.js';
import { authLimiter, jsonBody, resetLimit, signupLimiter } from '../lib/ratelimit.js';

export const accounts = new Hono<AppEnv>();

/** The user shape the API publishes — never the password hash or the TOTP secret. */
export const publicUser = (u: User | SessionUser) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  org_id: u.org_id,
  // A row carries branch_ids as JSON; a session user already has it parsed.
  branch_ids: Array.isArray(u.branch_ids) ? u.branch_ids : JSON.parse(u.branch_ids || '[]') as string[],
  two_factor: !!u.totp_secret,
});

/* ---------- signup: creates tenant + owner + trial subscription ---------- */

accounts.post('/auth/signup', signupLimiter, async (c) => {
  const body = await jsonBody(c);
  const name = String(body.name ?? '');
  const email = String(body.email ?? '');
  const password = String(body.password ?? '');
  const orgName = String(body.org_name ?? '');
  const country = String(body.country ?? 'IN');

  if (!name || !email || !password || !orgName)
    return c.json({ error: 'name, email, password, org_name required' }, 400);
  if (password.length < 8) return c.json({ error: 'password_too_short' }, 400);
  if (await db.query.users.findFirst({ where: eq(users.email, email) }))
    return c.json({ error: 'email_taken' }, 409);

  const orgId = uid('org');
  const userId = uid('usr');
  const trialEnd = new Date(Date.now() + 14 * 864e5).toISOString();

  // One transaction: an org with no owner, or an owner with no branch, would be a
  // tenant nobody can use.
  await db.transaction(async (tx) => {
    await tx.insert(organizations).values({
      id: orgId, name: orgName, plan_tier: 'trial', country, status: 'active', created_at: now(),
    });
    await tx.insert(users).values({
      id: userId, org_id: orgId, name, email, password_hash: hash(password),
      role: 'owner', created_at: now(),
    });
    await tx.insert(subscriptions).values({
      id: uid('sub'), org_id: orgId, plan: 'trial', status: 'trialing',
      trial_ends_at: trialEnd, renews_at: trialEnd, gateway: 'manual', created_at: now(),
    });
    await tx.insert(branches).values({
      id: uid('brn'), org_id: orgId, name: 'Main Branch',
      timezone: country === 'IN' ? 'Asia/Kolkata' : 'UTC', created_at: now(),
    });
  });

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return c.json({ error: 'signup_failed' }, 500);
  return c.json({ token: signUser(user), user: publicUser(user), org_id: orgId }, 201);
});

accounts.post('/auth/login', authLimiter, async (c) => {
  const body = await jsonBody(c);
  const email = String(body.email ?? '');
  const password = String(body.password ?? '');

  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  // One message for a bad email, a bad password and a disabled account: anything
  // else tells an attacker which addresses are real.
  if (!user || !check(password, user.password_hash) || user.status !== 'active')
    return c.json({ error: 'invalid_credentials' }, 401);

  const org = user.org_id
    ? await db.query.organizations.findFirst({ where: eq(organizations.id, user.org_id) })
    : null;
  if (org?.require_2fa && !user.totp_secret) return c.json({ error: 'enroll_2fa_required' }, 403);
  if (user.totp_secret) {
    if (body.totp === undefined) return c.json({ error: 'totp_required' }, 401);
    if (!totpVerify(user.totp_secret, body.totp)) return c.json({ error: 'invalid_totp' }, 401);
  }
  // A correct password clears the bucket, so a typo streak cannot lock out the user.
  resetLimit(c, 'auth', email.toLowerCase());
  return c.json({ token: signUser(user), user: publicUser(user) });
});

/** SSO exchange (Google Workspace / Entra). Users must already be provisioned. */
accounts.post('/auth/sso', authLimiter, async (c) => {
  const body = await jsonBody(c);
  const email = String(body.email ?? '');
  const provider = String(body.provider ?? 'google');

  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user) return c.json({ error: 'sso_user_not_provisioned' }, 401);
  const org = user.org_id
    ? await db.query.organizations.findFirst({ where: eq(organizations.id, user.org_id) })
    : null;
  if (!org || !planOf(org).features.includes('sso')) return c.json({ error: 'sso_not_in_plan' }, 402);
  return c.json({ token: signUser(user), user: publicUser(user), provider });
});

/* ---------- password reset ---------- */

// In-process on purpose: a reset token is short-lived and single-use, and losing the
// pending set on restart only means the user asks again. Production wires this to
// whatever sends the email.
const resetTokens = new Map<string, { user_id: string; exp: number }>();

accounts.post('/auth/forgot-password', authLimiter, async (c) => {
  const body = await jsonBody(c);
  const user = await db.query.users.findFirst({ where: eq(users.email, String(body.email ?? '')) });
  // Always 200: a different answer for an unknown address enumerates accounts.
  if (!user) return c.json({ ok: true });
  const token = uid('rst');
  resetTokens.set(token, { user_id: user.id, exp: Date.now() + 30 * 60_000 });
  return c.json({
    ok: true,
    // Only outside production, where there is no mail transport to receive it.
    ...(process.env.NODE_ENV === 'production' ? {} : { reset_token: token }),
  });
});

accounts.post('/auth/reset-password', async (c) => {
  const body = await jsonBody(c);
  const token = String(body.token ?? '');
  const password = String(body.password ?? '');
  const entry = resetTokens.get(token);
  if (!entry || entry.exp < Date.now()) return c.json({ error: 'invalid_or_expired' }, 400);
  if (password.length < 8) return c.json({ error: 'password_too_short' }, 400);
  await db.update(users).set({ password_hash: hash(password) }).where(eq(users.id, entry.user_id));
  resetTokens.delete(token);
  return c.json({ ok: true });
});

accounts.get('/auth/me', requireAuth, async (c) => {
  const org = c.get('org');
  return c.json({
    user: publicUser(c.get('user')),
    impersonating: c.get('impersonated'),
    org: org && {
      id: org.id, name: org.name, plan_tier: org.plan_tier, country: org.country,
      status: org.status, require_2fa: !!org.require_2fa, approval_required: !!org.approval_required,
      feature_flags: JSON.parse(org.feature_flags || '{}') as Record<string, boolean>,
    },
    plan: org ? planOf(org) : null,
    usage: org ? await usage(org.id) : null,
  });
});

/* ---------- 2FA enrollment ---------- */

accounts.post('/auth/2fa/setup', requireAuth, async (c) => {
  const user = c.get('user');
  const secret = totpSecret();
  await db.update(users).set({ totp_secret: secret }).where(eq(users.id, user.id));
  await audit(auditActor(c), '2fa.setup', user.id);
  return c.json({
    secret,
    otpauth: `otpauth://totp/BrandcastTV:${user.email}?secret=${secret}&issuer=BrandcastTV`,
  });
});

accounts.post('/auth/2fa/disable', requireAuth, async (c) => {
  const user = c.get('user');
  // A tenant that mandates 2FA does not let a member opt out of it.
  if (c.get('org')?.require_2fa) return c.json({ error: '2fa_enforced_by_org' }, 403);
  await db.update(users).set({ totp_secret: null }).where(eq(users.id, user.id));
  await audit(auditActor(c), '2fa.disable', user.id);
  return c.json({ ok: true });
});

/* ---------- organization ---------- */

accounts.patch('/org', requireAuth, requirePerm('org:write'), async (c) => {
  const org = c.get('org');
  if (!org) return c.json({ error: 'unauthorized' }, 401);
  const body = await jsonBody(c);
  await db.update(organizations).set({
    name: body.name === undefined ? org.name : String(body.name),
    require_2fa: body.require_2fa === undefined ? org.require_2fa : (body.require_2fa ? 1 : 0),
    approval_required: body.approval_required === undefined
      ? org.approval_required : (body.approval_required ? 1 : 0),
    gstin: body.gstin === undefined ? org.gstin : String(body.gstin),
    country: body.country === undefined ? org.country : String(body.country),
  }).where(eq(organizations.id, org.id));
  await audit(auditActor(c), 'org.update', org.id, body);
  return c.json(await db.query.organizations.findFirst({ where: eq(organizations.id, org.id) }));
});

/* ---------- users & invites ---------- */

accounts.get('/users', requireAuth, async (c) => {
  const rows = await db.select().from(users)
    .where(eq(users.org_id, c.get('orgId'))).orderBy(asc(users.created_at));
  return c.json(rows.map(publicUser));
});

accounts.post('/users/invite', requireAuth, requirePerm('user:write'), async (c) => {
  const org = c.get('org');
  if (!org) return c.json({ error: 'unauthorized' }, 401);
  const body = await jsonBody(c);
  const email = String(body.email ?? '');
  const role = String(body.role ?? 'viewer');
  const branchIds = Array.isArray(body.branch_ids) ? body.branch_ids : [];

  // superadmin is a platform role; it is never granted from inside a tenant.
  if (!email || !isRole(role) || role === 'superadmin')
    return c.json({ error: 'valid email and role required' }, 400);
  const limit = await limitCheck(org, 'user');
  if (!limit.ok) return c.json(limit, 402);

  const token = uid('inv');
  await db.insert(invites).values({
    id: uid('ivt'), org_id: org.id, email, role,
    branch_ids: JSON.stringify(branchIds), token, created_at: now(),
  });
  await audit(auditActor(c), 'user.invite', email, { role });
  return c.json({ ok: true, invite_token: token, accept_url: `/accept-invite?token=${token}` }, 201);
});

accounts.get('/users/invites', requireAuth, requirePerm('user:write'), async (c) => {
  const rows = await db.select({
    id: invites.id, email: invites.email, role: invites.role,
    status: invites.status, created_at: invites.created_at, token: invites.token,
  }).from(invites).where(and(eq(invites.org_id, c.get('orgId')), eq(invites.status, 'pending')));
  return c.json(rows);
});

accounts.post('/users/accept-invite', async (c) => {
  const body = await jsonBody(c);
  const token = String(body.token ?? '');
  const name = String(body.name ?? '');
  const password = String(body.password ?? '');

  const invite = await db.query.invites.findFirst({
    where: and(eq(invites.token, token), eq(invites.status, 'pending')),
  });
  if (!invite) return c.json({ error: 'invalid_invite' }, 400);
  if (!name || password.length < 8) return c.json({ error: 'name and 8+ char password required' }, 400);
  if (await db.query.users.findFirst({ where: eq(users.email, invite.email) }))
    return c.json({ error: 'email_taken' }, 409);

  const id = uid('usr');
  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id, org_id: invite.org_id, name, email: invite.email, password_hash: hash(password),
      role: invite.role, branch_ids: invite.branch_ids, created_at: now(),
    });
    await tx.update(invites).set({ status: 'accepted' }).where(eq(invites.id, invite.id));
  });

  const user = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!user) return c.json({ error: 'invite_failed' }, 500);
  return c.json({ token: signUser(user), user: publicUser(user) }, 201);
});

accounts.patch('/users/:id', requireAuth, requirePerm('user:write'), async (c) => {
  const actor = c.get('user');
  const target = await db.query.users.findFirst({
    where: and(eq(users.id, c.req.param('id')), eq(users.org_id, c.get('orgId'))),
  });
  if (!target) return c.json({ error: 'not_found' }, 404);
  // An admin can manage the team but not rewrite the person who owns the account.
  if (target.role === 'owner' && actor.role !== 'owner')
    return c.json({ error: 'only_owner_edits_owner' }, 403);

  const body = await jsonBody(c);
  const role = body.role === undefined ? undefined : String(body.role);
  if (role !== undefined && (!isRole(role) || role === 'superadmin'))
    return c.json({ error: 'bad_role' }, 400);

  await db.update(users).set({
    role: role ?? target.role,
    branch_ids: body.branch_ids ? JSON.stringify(body.branch_ids) : target.branch_ids,
    status: body.status === undefined ? target.status : String(body.status),
    name: body.name === undefined ? target.name : String(body.name),
  }).where(eq(users.id, target.id));
  await audit(auditActor(c), 'user.update', target.id, body);

  const updated = await db.query.users.findFirst({ where: eq(users.id, target.id) });
  return c.json(updated ? publicUser(updated) : { error: 'not_found' });
});

accounts.delete('/users/:id', requireAuth, requirePerm('user:write'), async (c) => {
  const target = await db.query.users.findFirst({
    where: and(eq(users.id, c.req.param('id')), eq(users.org_id, c.get('orgId'))),
  });
  if (!target) return c.json({ error: 'not_found' }, 404);
  if (target.role === 'owner') return c.json({ error: 'cannot_remove_owner' }, 403);
  // Disabled, not deleted: their audit trail and authored content stay attributable.
  await db.update(users).set({ status: 'disabled' }).where(eq(users.id, target.id));
  await audit(auditActor(c), 'user.disable', target.id);
  return c.json({ ok: true });
});

/* ---------- branches ---------- */

accounts.get('/branches', requireAuth, async (c) => {
  const user = c.get('user');
  let rows = await db.select().from(branches)
    .where(eq(branches.org_id, c.get('orgId'))).orderBy(asc(branches.created_at));
  if (user.role === 'branch_manager') rows = rows.filter((b) => user.branch_ids.includes(b.id));

  const out = [];
  for (const b of rows) {
    const [tally] = await db.select({ c: count() }).from(screens).where(eq(screens.branch_id, b.id));
    out.push({ ...b, screen_count: tally?.c ?? 0 });
  }
  return c.json(out);
});

accounts.post('/branches', requireAuth, requirePerm('branch:write'), async (c) => {
  const body = await jsonBody(c);
  const name = String(body.name ?? '');
  const timezone = String(body.timezone ?? 'Asia/Kolkata');
  if (!name) return c.json({ error: 'name required' }, 400);
  // Dayparting is resolved in this zone, so an invalid one has to fail here rather
  // than silently shift every schedule to UTC.
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); }
  catch { return c.json({ error: 'invalid_timezone' }, 400); }

  const id = uid('brn');
  await db.insert(branches).values({
    id, org_id: c.get('orgId'), name, timezone,
    address: body.address === undefined ? null : String(body.address), created_at: now(),
  });
  await audit(auditActor(c), 'branch.create', id, { name });
  return c.json(await db.query.branches.findFirst({ where: eq(branches.id, id) }), 201);
});

accounts.patch('/branches/:id', requireAuth, requirePerm('branch:write'), async (c) => {
  const branch = await db.query.branches.findFirst({
    where: and(eq(branches.id, c.req.param('id')), eq(branches.org_id, c.get('orgId'))),
  });
  if (!branch) return c.json({ error: 'not_found' }, 404);
  const body = await jsonBody(c);
  await db.update(branches).set({
    name: body.name === undefined ? branch.name : String(body.name),
    timezone: body.timezone === undefined ? branch.timezone : String(body.timezone),
    address: body.address === undefined ? branch.address : String(body.address),
    status: body.status === undefined ? branch.status : String(body.status),
    default_playlist_id: body.default_playlist_id === undefined
      ? branch.default_playlist_id : (body.default_playlist_id as string | null),
    default_ticker_id: body.default_ticker_id === undefined
      ? branch.default_ticker_id : (body.default_ticker_id as string | null),
  }).where(eq(branches.id, branch.id));
  await audit(auditActor(c), 'branch.update', branch.id, body);
  return c.json(await db.query.branches.findFirst({ where: eq(branches.id, branch.id) }));
});

accounts.delete('/branches/:id', requireAuth, requirePerm('branch:write'), async (c) => {
  const branch = await db.query.branches.findFirst({
    where: and(eq(branches.id, c.req.param('id')), eq(branches.org_id, c.get('orgId'))),
  });
  if (!branch) return c.json({ error: 'not_found' }, 404);
  // Archived, not deleted: its screens and their history stay intact.
  await db.update(branches).set({ status: 'archived' }).where(eq(branches.id, branch.id));
  await audit(auditActor(c), 'branch.archive', branch.id);
  return c.json({ ok: true });
});

accounts.get('/plans', (c) => c.json(PLANS));
