import express from 'express';
import { db, uid, now } from '../lib/db.js';
import { requireAuth, requireSuperadmin, signUser, audit } from '../lib/auth.js';
import { PLANS, planOf, usage } from '../lib/plans.js';
import * as hub from '../lib/hub.js';
import { schedulerTick, healthTick, billingTick } from '../lib/jobs.js';

export const router = express.Router();
router.use(requireAuth, requireSuperadmin);

router.get('/admin/tenants', (req, res) => {
  const orgs = db.prepare('SELECT * FROM organizations ORDER BY created_at DESC').all();
  res.json(orgs.map((o) => ({
    ...o,
    feature_flags: JSON.parse(o.feature_flags || '{}'),
    usage: usage(o.id),
    plan: planOf(o),
    subscription: db.prepare('SELECT * FROM subscriptions WHERE org_id=?').get(o.id) || null,
    online_screens: db.prepare("SELECT COUNT(*) c FROM screens WHERE org_id=? AND status='online'").get(o.id).c,
    revenue_mrr: planOf(o).price_per_screen * usage(o.id).screens,
  })));
});

router.get('/admin/tenants/:id', (req, res) => {
  const o = db.prepare('SELECT * FROM organizations WHERE id=?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'not_found' });
  res.json({
    org: { ...o, feature_flags: JSON.parse(o.feature_flags || '{}') },
    users: db.prepare('SELECT id,name,email,role,status FROM users WHERE org_id=?').all(o.id),
    branches: db.prepare('SELECT * FROM branches WHERE org_id=?').all(o.id),
    screens: db.prepare('SELECT id,name,status,last_seen_at FROM screens WHERE org_id=?').all(o.id),
    invoices: db.prepare('SELECT * FROM invoices WHERE org_id=? ORDER BY created_at DESC LIMIT 12').all(o.id),
    audit: db.prepare('SELECT * FROM audit_logs WHERE org_id=? ORDER BY created_at DESC LIMIT 50').all(o.id),
  });
});

router.post('/admin/tenants/:id/suspend', (req, res) => {
  const o = db.prepare('SELECT * FROM organizations WHERE id=?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'not_found' });
  const status = o.status === 'suspended' ? 'active' : 'suspended';
  db.prepare('UPDATE organizations SET status=? WHERE id=?').run(status, o.id);
  audit(req, 'admin.tenant.status', o.id, { status });
  res.json({ ok: true, status });
});

router.post('/admin/tenants/:id/plan', (req, res) => {
  const { plan } = req.body || {};
  if (!PLANS[plan]) return res.status(400).json({ error: 'unknown_plan' });
  db.prepare('UPDATE organizations SET plan_tier=? WHERE id=?').run(plan, req.params.id);
  db.prepare("UPDATE subscriptions SET plan=?, status='active' WHERE org_id=?").run(plan, req.params.id);
  audit(req, 'admin.tenant.plan', req.params.id, { plan });
  res.json({ ok: true, plan });
});

/** Per-org feature flags for staged rollout; overrides plan defaults. */
router.post('/admin/tenants/:id/flags', (req, res) => {
  const o = db.prepare('SELECT * FROM organizations WHERE id=?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'not_found' });
  const flags = { ...JSON.parse(o.feature_flags || '{}'), ...(req.body?.flags || {}) };
  for (const k of Object.keys(flags)) if (flags[k] === null) delete flags[k];
  db.prepare('UPDATE organizations SET feature_flags=? WHERE id=?').run(JSON.stringify(flags), o.id);
  audit(req, 'admin.tenant.flags', o.id, flags);
  res.json({ ok: true, feature_flags: flags });
});

/** Support login: issue a token scoped to the tenant, fully audit-logged. */
router.post('/admin/tenants/:id/impersonate', (req, res) => {
  const o = db.prepare('SELECT * FROM organizations WHERE id=?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'not_found' });
  audit(req, 'admin.impersonate', o.id, { reason: req.body?.reason || 'support' });
  db.prepare('INSERT INTO audit_logs (id,org_id,actor_id,actor_email,action,target,impersonated,created_at) VALUES (?,?,?,?,?,?,1,?)')
    .run(uid('aud'), o.id, req.user.id, req.user.email, 'support.session.start', o.id, now());
  res.json({ token: signUser(req.user, { act_org: o.id }), org: { id: o.id, name: o.name } });
});

router.get('/admin/health', (req, res) => {
  const screens = db.prepare('SELECT COUNT(*) c FROM screens').get().c;
  const online = db.prepare("SELECT COUNT(*) c FROM screens WHERE status='online'").get().c;
  const orgs = db.prepare('SELECT COUNT(*) c FROM organizations').get().c;
  const pub24 = db.prepare('SELECT COUNT(*) c FROM publish_events WHERE created_at > ?')
    .get(new Date(Date.now() - 864e5).toISOString()).c;
  const mrr = db.prepare('SELECT * FROM organizations').all()
    .reduce((a, o) => a + planOf(o).price_per_screen * usage(o.id).screens, 0);
  res.json({
    organizations: orgs, screens, online_screens: online,
    connected_sessions: hub.connectedCount(),
    publishes_24h: pub24, mrr,
    plan_distribution: db.prepare('SELECT plan_tier, COUNT(*) c FROM organizations GROUP BY plan_tier').all(),
    uptime_seconds: Math.round(process.uptime()),
    memory_mb: Math.round(process.memoryUsage().rss / 1e6),
    alerts: db.prepare("SELECT COUNT(*) c FROM screens WHERE status='offline' AND device_token IS NOT NULL").get().c,
  });
});

router.get('/admin/audit', (req, res) =>
  res.json(db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 300').all()));

router.post('/admin/jobs/run', (req, res) => {
  const republished = schedulerTick();
  healthTick(); billingTick();
  res.json({ ok: true, republished });
});
