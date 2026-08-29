import express from 'express';
import { db, uid, now } from '../lib/db.js';
import {
  hash, check, signUser, requireAuth, requirePerm, audit, totpSecret, totpVerify, ROLES,
} from '../lib/auth.js';
import { PLANS, usage, planOf, limitCheck } from '../lib/plans.js';
import { authLimiter, signupLimiter, resetLimit } from '../lib/ratelimit.js';

export const router = express.Router();

/* ---------- signup: creates tenant + owner + trial subscription ---------- */
router.post('/auth/signup', signupLimiter, (req, res) => {
  const { name, email, password, org_name, country = 'IN' } = req.body || {};
  if (!name || !email || !password || !org_name)
    return res.status(400).json({ error: 'name, email, password, org_name required' });
  if (String(password).length < 8) return res.status(400).json({ error: 'password_too_short' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email))
    return res.status(409).json({ error: 'email_taken' });

  const orgId = uid('org');
  const userId = uid('usr');
  const trialEnd = new Date(Date.now() + 14 * 864e5).toISOString();
  db.transaction(() => {
    db.prepare('INSERT INTO organizations (id,name,plan_tier,country,status,created_at) VALUES (?,?,?,?,?,?)')
      .run(orgId, org_name, 'trial', country, 'active', now());
    db.prepare('INSERT INTO users (id,org_id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(userId, orgId, name, email, hash(password), 'owner', now());
    db.prepare('INSERT INTO subscriptions (id,org_id,plan,status,trial_ends_at,renews_at,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(uid('sub'), orgId, 'trial', 'trialing', trialEnd, trialEnd, now());
    db.prepare('INSERT INTO branches (id,org_id,name,timezone,created_at) VALUES (?,?,?,?,?)')
      .run(uid('brn'), orgId, 'Main Branch', country === 'IN' ? 'Asia/Kolkata' : 'UTC', now());
  })();

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  res.status(201).json({ token: signUser(user), user: publicUser(user), org_id: orgId });
});

export const publicUser = (u) => ({
  id: u.id, name: u.name, email: u.email, role: u.role, org_id: u.org_id,
  branch_ids: Array.isArray(u.branch_ids) ? u.branch_ids : JSON.parse(u.branch_ids || '[]'),
  two_factor: !!u.totp_secret,
});

router.post('/auth/login', authLimiter, (req, res) => {
  const { email, password, totp } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email || '');
  if (!user || !check(password || '', user.password_hash) || user.status !== 'active')
    return res.status(401).json({ error: 'invalid_credentials' });

  const org = user.org_id ? db.prepare('SELECT * FROM organizations WHERE id = ?').get(user.org_id) : null;
  if (org?.require_2fa && !user.totp_secret) return res.status(403).json({ error: 'enroll_2fa_required' });
  if (user.totp_secret) {
    if (!totp) return res.status(401).json({ error: 'totp_required' });
    if (!totpVerify(user.totp_secret, totp)) return res.status(401).json({ error: 'invalid_totp' });
  }
  resetLimit(req, 'auth', (email || '').toLowerCase());
  res.json({ token: signUser(user), user: publicUser(user) });
});

/* ---------- SSO (Google Workspace / Entra) simulated exchange ---------- */
router.post('/auth/sso', authLimiter, (req, res) => {
  const { email, provider = 'google' } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email || '');
  if (!user) return res.status(401).json({ error: 'sso_user_not_provisioned' });
  const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(user.org_id);
  if (!planOf(org).features.includes('sso')) return res.status(402).json({ error: 'sso_not_in_plan' });
  res.json({ token: signUser(user), user: publicUser(user), provider });
});

/* ---------- password reset ---------- */
const resetTokens = new Map();
router.post('/auth/forgot-password', authLimiter, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(req.body?.email || '');
  if (!user) return res.json({ ok: true }); // no enumeration
  const token = uid('rst');
  resetTokens.set(token, { user_id: user.id, exp: Date.now() + 30 * 60_000 });
  res.json({ ok: true, reset_token: process.env.NODE_ENV === 'production' ? undefined : token });
});
router.post('/auth/reset-password', (req, res) => {
  const { token, password } = req.body || {};
  const entry = resetTokens.get(token);
  if (!entry || entry.exp < Date.now()) return res.status(400).json({ error: 'invalid_or_expired' });
  if (String(password || '').length < 8) return res.status(400).json({ error: 'password_too_short' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash(password), entry.user_id);
  resetTokens.delete(token);
  res.json({ ok: true });
});

router.get('/auth/me', requireAuth, (req, res) => {
  const org = req.org;
  res.json({
    user: publicUser(req.user),
    impersonating: req.impersonated,
    org: org && {
      id: org.id, name: org.name, plan_tier: org.plan_tier, country: org.country,
      status: org.status, require_2fa: !!org.require_2fa, approval_required: !!org.approval_required,
      feature_flags: JSON.parse(org.feature_flags || '{}'),
    },
    plan: org ? planOf(org) : null,
    usage: org ? usage(org.id) : null,
  });
});

/* ---------- 2FA enrollment ---------- */
router.post('/auth/2fa/setup', requireAuth, (req, res) => {
  const secret = totpSecret();
  db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret, req.user.id);
  audit(req, '2fa.setup', req.user.id);
  res.json({ secret, otpauth: `otpauth://totp/BrandcastTV:${req.user.email}?secret=${secret}&issuer=BrandcastTV` });
});
router.post('/auth/2fa/disable', requireAuth, (req, res) => {
  if (req.org?.require_2fa) return res.status(403).json({ error: '2fa_enforced_by_org' });
  db.prepare('UPDATE users SET totp_secret = NULL WHERE id = ?').run(req.user.id);
  audit(req, '2fa.disable', req.user.id);
  res.json({ ok: true });
});

/* ---------- organization ---------- */
router.patch('/org', requireAuth, requirePerm('org:write'), (req, res) => {
  const { name, require_2fa, approval_required, gstin, country } = req.body || {};
  const org = req.org;
  db.prepare('UPDATE organizations SET name=?, require_2fa=?, approval_required=?, gstin=?, country=? WHERE id=?')
    .run(name ?? org.name, require_2fa === undefined ? org.require_2fa : (require_2fa ? 1 : 0),
         approval_required === undefined ? org.approval_required : (approval_required ? 1 : 0),
         gstin ?? org.gstin, country ?? org.country, org.id);
  audit(req, 'org.update', org.id, req.body);
  res.json(db.prepare('SELECT * FROM organizations WHERE id = ?').get(org.id));
});

/* ---------- users & invites ---------- */
router.get('/users', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM users WHERE org_id = ? ORDER BY created_at').all(req.orgId).map(publicUser));
});

router.post('/users/invite', requireAuth, requirePerm('user:write'), (req, res) => {
  const { email, role = 'viewer', branch_ids = [] } = req.body || {};
  if (!email || !ROLES.includes(role) || role === 'superadmin')
    return res.status(400).json({ error: 'valid email and role required' });
  const lim = limitCheck(req.org, 'user');
  if (!lim.ok) return res.status(402).json(lim);
  const token = uid('inv');
  db.prepare('INSERT INTO invites (id,org_id,email,role,branch_ids,token,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(uid('ivt'), req.orgId, email, role, JSON.stringify(branch_ids), token, now());
  audit(req, 'user.invite', email, { role });
  res.status(201).json({ ok: true, invite_token: token, accept_url: `/accept-invite?token=${token}` });
});

router.get('/users/invites', requireAuth, requirePerm('user:write'), (req, res) => {
  res.json(db.prepare("SELECT id,email,role,status,created_at,token FROM invites WHERE org_id=? AND status='pending'").all(req.orgId));
});

router.post('/users/accept-invite', (req, res) => {
  const { token, name, password } = req.body || {};
  const inv = db.prepare("SELECT * FROM invites WHERE token=? AND status='pending'").get(token || '');
  if (!inv) return res.status(400).json({ error: 'invalid_invite' });
  if (!name || String(password || '').length < 8) return res.status(400).json({ error: 'name and 8+ char password required' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(inv.email)) return res.status(409).json({ error: 'email_taken' });
  const id = uid('usr');
  db.prepare('INSERT INTO users (id,org_id,name,email,password_hash,role,branch_ids,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, inv.org_id, name, inv.email, hash(password), inv.role, inv.branch_ids, now());
  db.prepare("UPDATE invites SET status='accepted' WHERE id=?").run(inv.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.status(201).json({ token: signUser(user), user: publicUser(user) });
});

router.patch('/users/:id', requireAuth, requirePerm('user:write'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=? AND org_id=?').get(req.params.id, req.orgId);
  if (!u) return res.status(404).json({ error: 'not_found' });
  if (u.role === 'owner' && req.user.role !== 'owner') return res.status(403).json({ error: 'only_owner_edits_owner' });
  const { role, branch_ids, status, name } = req.body || {};
  if (role && (!ROLES.includes(role) || role === 'superadmin')) return res.status(400).json({ error: 'bad_role' });
  db.prepare('UPDATE users SET role=?, branch_ids=?, status=?, name=? WHERE id=?')
    .run(role ?? u.role, branch_ids ? JSON.stringify(branch_ids) : u.branch_ids, status ?? u.status, name ?? u.name, u.id);
  audit(req, 'user.update', u.id, req.body);
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(u.id)));
});

router.delete('/users/:id', requireAuth, requirePerm('user:write'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=? AND org_id=?').get(req.params.id, req.orgId);
  if (!u) return res.status(404).json({ error: 'not_found' });
  if (u.role === 'owner') return res.status(403).json({ error: 'cannot_remove_owner' });
  db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(u.id);
  audit(req, 'user.disable', u.id);
  res.json({ ok: true });
});

/* ---------- branches ---------- */
router.get('/branches', requireAuth, (req, res) => {
  let rows = db.prepare('SELECT * FROM branches WHERE org_id = ? ORDER BY created_at').all(req.orgId);
  if (req.user.role === 'branch_manager') rows = rows.filter((b) => req.user.branch_ids.includes(b.id));
  res.json(rows.map((b) => ({
    ...b,
    screen_count: db.prepare('SELECT COUNT(*) c FROM screens WHERE branch_id=?').get(b.id).c,
  })));
});

router.post('/branches', requireAuth, requirePerm('branch:write'), (req, res) => {
  const { name, timezone = 'Asia/Kolkata', address } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); }
  catch { return res.status(400).json({ error: 'invalid_timezone' }); }
  const id = uid('brn');
  db.prepare('INSERT INTO branches (id,org_id,name,timezone,address,created_at) VALUES (?,?,?,?,?,?)')
    .run(id, req.orgId, name, timezone, address || null, now());
  audit(req, 'branch.create', id, { name });
  res.status(201).json(db.prepare('SELECT * FROM branches WHERE id=?').get(id));
});

router.patch('/branches/:id', requireAuth, requirePerm('branch:write'), (req, res) => {
  const b = db.prepare('SELECT * FROM branches WHERE id=? AND org_id=?').get(req.params.id, req.orgId);
  if (!b) return res.status(404).json({ error: 'not_found' });
  const { name, timezone, address, status, default_playlist_id, default_ticker_id } = req.body || {};
  db.prepare('UPDATE branches SET name=?,timezone=?,address=?,status=?,default_playlist_id=?,default_ticker_id=? WHERE id=?')
    .run(name ?? b.name, timezone ?? b.timezone, address ?? b.address, status ?? b.status,
         default_playlist_id ?? b.default_playlist_id, default_ticker_id ?? b.default_ticker_id, b.id);
  audit(req, 'branch.update', b.id, req.body);
  res.json(db.prepare('SELECT * FROM branches WHERE id=?').get(b.id));
});

router.delete('/branches/:id', requireAuth, requirePerm('branch:write'), (req, res) => {
  const b = db.prepare('SELECT * FROM branches WHERE id=? AND org_id=?').get(req.params.id, req.orgId);
  if (!b) return res.status(404).json({ error: 'not_found' });
  db.prepare("UPDATE branches SET status='archived' WHERE id=?").run(b.id);
  audit(req, 'branch.archive', b.id);
  res.json({ ok: true });
});

router.get('/plans', (_req, res) => res.json(PLANS));
