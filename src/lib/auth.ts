// SOT: authentication, jwt, rbac, permissions, audit, totp
// WHAT:  who the caller is, what they may do, and the record that they did it.
// WHY:   every tenant boundary in the product is enforced here. The org a request
//        acts in comes off the verified token, so a caller cannot reach another
//        tenant's rows by changing a field in the body.
// HOW:   a JWT carries the user and, for support sessions, the impersonated org.
//        Middleware resolves it to a row, checks the org is not suspended, and puts
//        both on the context. Permissions are a flat list per role.
// WHERE: context type in src/lib/http.ts; used by every router in src/routes/

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { auditLogs, notifications, organizations, screens, users } from '../db/schema.js';
import type { Screen, User } from '../db/schema.js';
import type { Context } from 'hono';
import type { AppEnv, Middleware, SessionUser } from './http.js';
import { now, uid } from './ids.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'brandcast-dev-secret-change-me';
export const SESSION_TTL = process.env.SESSION_TTL || '12h';

export const hash = (pw: string): string => bcrypt.hashSync(pw, 10);
export const check = (pw: string, h: string): boolean => bcrypt.compareSync(pw, h);

export type TokenPayload = {
  sub: string;
  org_id: string | null;
  role?: string;
  email?: string;
  /** Present only on a superadmin support session: the tenant being acted in. */
  act_org?: string;
  kind?: 'device';
};

/** Accepts a row or a session user; only the identity fields go into the token. */
export function signUser(
  user: Pick<User, 'id' | 'org_id' | 'role' | 'email'>, extra: Record<string, unknown> = {},
): string {
  return jwt.sign(
    { sub: user.id, org_id: user.org_id, role: user.role, email: user.email, ...extra },
    JWT_SECRET,
    { expiresIn: SESSION_TTL } as jwt.SignOptions,
  );
}

/** A device token is long-lived; revoking it means nulling screens.device_token. */
export const signDevice = (screen: Screen): string =>
  jwt.sign({ sub: screen.id, org_id: screen.org_id, kind: 'device' }, JWT_SECRET, { expiresIn: '365d' });

export function verify(token: string): TokenPayload | null {
  try { return jwt.verify(token, JWT_SECRET) as TokenPayload; } catch { return null; }
}

/* ---------------- RBAC ---------------- */

export const ROLES = ['viewer', 'content_editor', 'branch_manager', 'admin', 'owner', 'superadmin'] as const;
export type Role = (typeof ROLES)[number];
export const isRole = (v: unknown): v is Role => ROLES.includes(v as Role);

export const PERMISSIONS: Record<Role, readonly string[]> = {
  viewer:         ['read'],
  content_editor: ['read', 'content:write'],
  branch_manager: ['read', 'content:write', 'content:publish', 'screen:write', 'branch:read'],
  admin:          ['read', 'content:write', 'content:publish', 'content:approve', 'screen:write', 'branch:read', 'branch:write', 'user:write', 'org:write'],
  owner:          ['read', 'content:write', 'content:publish', 'content:approve', 'screen:write', 'branch:read', 'branch:write', 'user:write', 'org:write', 'billing:write'],
  superadmin:     ['*'],
};

export type Permission = (typeof PERMISSIONS)['owner'][number];

export const can = (role: string, perm: string): boolean => {
  const granted = PERMISSIONS[role as Role] ?? [];
  return granted.includes('*') || granted.includes(perm);
};

const bearer = (header: string | undefined, fallback: string | undefined): string | undefined => {
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return fallback;
};

export const requireAuth: Middleware = async (c, next) => {
  const token = bearer(c.req.header('authorization'), c.req.query('token'));
  const payload = token ? verify(token) : null;
  // A device token is not a user session; it must not reach the dashboard API.
  if (!payload || payload.kind === 'device') return c.json({ error: 'unauthorized' }, 401);

  const user = await db.query.users.findFirst({ where: eq(users.id, payload.sub) });
  if (!user || user.status !== 'active') return c.json({ error: 'unauthorized' }, 401);

  const orgId = payload.act_org || user.org_id;
  const session: SessionUser = { ...user, branch_ids: JSON.parse(user.branch_ids || '[]') as string[] };
  c.set('user', session);
  c.set('orgId', orgId ?? '');
  c.set('impersonated', !!payload.act_org && user.role === 'superadmin');
  c.set('org', null);

  if (orgId) {
    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
    if (!org) return c.json({ error: 'org_missing' }, 401);
    // A suspended tenant is frozen for its own people; support can still get in.
    if (org.status === 'suspended' && user.role !== 'superadmin')
      return c.json({ error: 'organization_suspended' }, 403);
    c.set('org', org);
  }
  await next();
};

export const requirePerm = (perm: string): Middleware => async (c, next) => {
  if (!can(c.get('user').role, perm)) return c.json({ error: 'forbidden', need: perm }, 403);
  await next();
};

export const requireSuperadmin: Middleware = async (c, next) => {
  if (c.get('user')?.role !== 'superadmin') return c.json({ error: 'forbidden' }, 403);
  await next();
};

/** Branch managers only see and touch the branches assigned to them. */
export function branchAllowed(user: SessionUser, branchId: string): boolean {
  if (user.role === 'branch_manager') return user.branch_ids.includes(branchId);
  return true;
}

/**
 * The TV client's own credential. The token is checked against the stored one, so
 * unpairing a screen cuts it off on the next request rather than at token expiry.
 */
export const requireDevice: Middleware = async (c, next) => {
  const token = bearer(c.req.header('authorization'), c.req.query('device_token'));
  const payload = token ? verify(token) : null;
  if (!payload || payload.kind !== 'device') return c.json({ error: 'unauthorized' }, 401);
  const screen = await db.query.screens.findFirst({
    where: and(eq(screens.id, payload.sub), eq(screens.device_token, token!)),
  });
  if (!screen) return c.json({ error: 'device_revoked' }, 401);
  c.set('screen', screen);
  await next();
};

/* ---------------- audit / notify ---------------- */

export type AuditActor = {
  orgId?: string | null;
  user?: { id: string; email: string } | null;
  impersonated?: boolean;
};

/** The actor for an audit row, taken from the authenticated context. */
export const auditActor = (c: Context<AppEnv>): AuditActor => {
  const user = c.get('user');
  return {
    orgId: c.get('orgId') || null,
    user: user ? { id: user.id, email: user.email } : null,
    impersonated: c.get('impersonated'),
  };
};

/** Append-only record of who changed what. Impersonated actions are flagged. */
export async function audit(
  actor: AuditActor, action: string, target?: string | null, detail?: unknown,
): Promise<void> {
  await db.insert(auditLogs).values({
    id: uid('aud'),
    org_id: actor.orgId ?? null,
    actor_id: actor.user?.id ?? null,
    actor_email: actor.user?.email ?? null,
    action,
    target: target ?? null,
    detail: detail === undefined ? null : JSON.stringify(detail),
    impersonated: actor.impersonated ? 1 : 0,
    created_at: now(),
  });
}

export async function notify(orgId: string, kind: string, message: string): Promise<void> {
  await db.insert(notifications).values({
    id: uid('ntf'), org_id: orgId, kind, message, read: 0, created_at: now(),
  });
}

/* ---------------- TOTP ---------------- */

// Re-exported so callers keep importing one auth module; the implementation is
// separate because it is pure crypto and must be usable without a database.
export { totpCode, totpSecret, totpVerify } from './totp.js';
