import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { db, uid, now } from './db.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'brandcast-dev-secret-change-me';
export const SESSION_TTL = process.env.SESSION_TTL || '12h';

export const hash = (pw) => bcrypt.hashSync(pw, 10);
export const check = (pw, h) => bcrypt.compareSync(pw, h);

export function signUser(user, extra = {}) {
  return jwt.sign(
    { sub: user.id, org_id: user.org_id, role: user.role, email: user.email, ...extra },
    JWT_SECRET,
    { expiresIn: SESSION_TTL }
  );
}
export const signDevice = (screen) =>
  jwt.sign({ sub: screen.id, org_id: screen.org_id, kind: 'device' }, JWT_SECRET, { expiresIn: '365d' });

export function verify(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

/* ---------------- RBAC ---------------- */
export const ROLES = ['viewer', 'content_editor', 'branch_manager', 'admin', 'owner', 'superadmin'];

export const PERMISSIONS = {
  viewer:         ['read'],
  content_editor: ['read', 'content:write'],
  branch_manager: ['read', 'content:write', 'content:publish', 'screen:write', 'branch:read'],
  admin:          ['read', 'content:write', 'content:publish', 'content:approve', 'screen:write', 'branch:read', 'branch:write', 'user:write', 'org:write'],
  owner:          ['read', 'content:write', 'content:publish', 'content:approve', 'screen:write', 'branch:read', 'branch:write', 'user:write', 'org:write', 'billing:write'],
  superadmin:     ['*'],
};

export const can = (role, perm) => {
  const p = PERMISSIONS[role] || [];
  return p.includes('*') || p.includes(perm);
};

export function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : req.query.token;
  const payload = token && verify(token);
  if (!payload || payload.kind === 'device') return res.status(401).json({ error: 'unauthorized' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
  if (!user || user.status !== 'active') return res.status(401).json({ error: 'unauthorized' });

  // superadmin impersonation carries an org context
  const orgId = payload.act_org || user.org_id;
  req.user = { ...user, branch_ids: JSON.parse(user.branch_ids || '[]') };
  req.orgId = orgId;
  req.impersonated = !!payload.act_org && user.role === 'superadmin';

  if (orgId) {
    const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId);
    if (!org) return res.status(401).json({ error: 'org_missing' });
    if (org.status === 'suspended' && user.role !== 'superadmin')
      return res.status(403).json({ error: 'organization_suspended' });
    req.org = org;
  }
  next();
}

export const requirePerm = (perm) => (req, res, next) =>
  can(req.user.role, perm) ? next() : res.status(403).json({ error: 'forbidden', need: perm });

export const requireSuperadmin = (req, res, next) =>
  req.user?.role === 'superadmin' ? next() : res.status(403).json({ error: 'forbidden' });

/** Branch managers are limited to their assigned branches. */
export function branchAllowed(user, branchId) {
  if (user.role === 'branch_manager') return user.branch_ids.includes(branchId);
  return true;
}

export function requireDevice(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : req.query.device_token;
  const payload = token && verify(token);
  if (!payload || payload.kind !== 'device') return res.status(401).json({ error: 'unauthorized' });
  const screen = db.prepare('SELECT * FROM screens WHERE id = ? AND device_token = ?').get(payload.sub, token);
  if (!screen) return res.status(401).json({ error: 'device_revoked' });
  req.screen = screen;
  next();
}

/* ---------------- audit / notify ---------------- */
export function audit(req, action, target, detail) {
  db.prepare(
    `INSERT INTO audit_logs (id, org_id, actor_id, actor_email, action, target, detail, impersonated, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(uid('aud'), req.orgId || null, req.user?.id || null, req.user?.email || null,
        action, target || null, detail ? JSON.stringify(detail) : null, req.impersonated ? 1 : 0, now());
}

export function notify(orgId, kind, message) {
  db.prepare('INSERT INTO notifications (id, org_id, kind, message, read, created_at) VALUES (?,?,?,?,0,?)')
    .run(uid('ntf'), orgId, kind, message, now());
}

/* ---------------- TOTP (RFC 6238) ---------------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const totpSecret = () =>
  Array.from(crypto.randomBytes(20)).map((b) => B32[b % 32]).join('');

function b32decode(s) {
  let bits = '';
  for (const c of s.toUpperCase().replace(/=+$/, '')) {
    const i = B32.indexOf(c);
    if (i < 0) continue;
    bits += i.toString(2).padStart(5, '0');
  }
  const out = Buffer.alloc(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}

export function totpCode(secret, t = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigInt64BE(BigInt(Math.floor(t / 30000)));
  const hmac = crypto.createHmac('sha1', b32decode(secret)).update(counter).digest();
  const off = hmac[hmac.length - 1] & 0xf;
  const bin = ((hmac[off] & 0x7f) << 24) | (hmac[off + 1] << 16) | (hmac[off + 2] << 8) | hmac[off + 3];
  return String(bin % 1e6).padStart(6, '0');
}

export const totpVerify = (secret, code) =>
  [-1, 0, 1].some((d) => totpCode(secret, Date.now() + d * 30000) === String(code || '').trim());
