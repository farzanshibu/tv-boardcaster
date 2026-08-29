import express from 'express';
import { db, uid, now } from '../lib/db.js';
import { requireAuth, requirePerm, audit } from '../lib/auth.js';
import { PLANS, planOf, usage } from '../lib/plans.js';
import { generateInvoice } from '../lib/jobs.js';
import * as hub from '../lib/hub.js';

export const router = express.Router();

/* ================= analytics ================= */

/** Uptime derived from status_events transitions over a window. */
router.get('/analytics/uptime', requireAuth, (req, res) => {
  const from = req.query.from || new Date(Date.now() - 30 * 864e5).toISOString();
  const to = req.query.to || now();
  const screens = db.prepare('SELECT * FROM screens WHERE org_id=?').all(req.orgId);
  const windowMs = Math.max(1, Date.parse(to) - Date.parse(from));

  const rows = screens.map((s) => {
    const events = db.prepare(
      'SELECT * FROM status_events WHERE screen_id=? AND created_at BETWEEN ? AND ? ORDER BY created_at'
    ).all(s.id, from, to);
    let onlineMs = 0, cursor = Date.parse(from);
    // assume it started in the opposite state of the first transition
    let state = events.length ? (events[0].kind === 'offline' ? 'online' : 'offline') : s.status;
    for (const e of events) {
      const t = Date.parse(e.created_at);
      if (state === 'online') onlineMs += t - cursor;
      if (e.kind === 'online' || e.kind === 'offline') state = e.kind;
      cursor = t;
    }
    if (state === 'online') onlineMs += Date.parse(to) - cursor;
    const branch = db.prepare('SELECT name FROM branches WHERE id=?').get(s.branch_id);
    return {
      screen_id: s.id, screen: s.name, branch: branch?.name || null, current_status: s.status,
      uptime_pct: Math.round(Math.min(100, (onlineMs / windowMs) * 100) * 10) / 10,
      online_hours: Math.round((onlineMs / 3.6e6) * 10) / 10,
      last_sync_at: s.last_sync_at,
    };
  });

  const byBranch = {};
  for (const r of rows) {
    byBranch[r.branch || 'Unassigned'] ??= { branch: r.branch, screens: 0, uptime_sum: 0 };
    byBranch[r.branch || 'Unassigned'].screens++;
    byBranch[r.branch || 'Unassigned'].uptime_sum += r.uptime_pct;
  }
  res.json({
    from, to, screens: rows,
    by_branch: Object.values(byBranch).map((b) => ({ ...b, uptime_pct: Math.round((b.uptime_sum / b.screens) * 10) / 10, uptime_sum: undefined })),
    fleet_uptime_pct: rows.length ? Math.round((rows.reduce((a, r) => a + r.uptime_pct, 0) / rows.length) * 10) / 10 : 0,
  });
});

/** Play counts and seconds played per media/playlist. */
router.get('/analytics/content', requireAuth, (req, res) => {
  const from = req.query.from || new Date(Date.now() - 30 * 864e5).toISOString();
  const to = req.query.to || now();
  const byMedia = db.prepare(
    `SELECT media_id, COUNT(*) plays, SUM(duration) seconds FROM play_events
     WHERE org_id=? AND created_at BETWEEN ? AND ? GROUP BY media_id ORDER BY plays DESC`
  ).all(req.orgId, from, to).map((r) => ({
    ...r, media: db.prepare('SELECT name,type FROM media WHERE id=?').get(r.media_id) || null,
  }));
  const byPlaylist = db.prepare(
    `SELECT playlist_id, COUNT(*) plays, SUM(duration) seconds FROM play_events
     WHERE org_id=? AND created_at BETWEEN ? AND ? GROUP BY playlist_id ORDER BY plays DESC`
  ).all(req.orgId, from, to).map((r) => ({
    ...r, playlist: db.prepare('SELECT name FROM playlists WHERE id=?').get(r.playlist_id) || null,
  }));
  res.json({ from, to, by_media: byMedia, by_playlist: byPlaylist });
});

router.get('/analytics/overview', requireAuth, (req, res) => {
  const screens = db.prepare('SELECT * FROM screens WHERE org_id=?').all(req.orgId);
  const u = usage(req.orgId);
  res.json({
    total_screens: screens.length,
    online_screens: screens.filter((s) => s.status === 'online').length,
    offline_screens: screens.filter((s) => s.status !== 'online').length,
    branches: db.prepare("SELECT COUNT(*) c FROM branches WHERE org_id=? AND status='active'").get(req.orgId).c,
    playlists: db.prepare('SELECT COUNT(*) c FROM playlists WHERE org_id=?').get(req.orgId).c,
    media: db.prepare('SELECT COUNT(*) c FROM media WHERE org_id=?').get(req.orgId).c,
    users: u.users,
    plan: planOf(req.org),
    usage: u,
    publishes_24h: db.prepare("SELECT COUNT(*) c FROM publish_events WHERE org_id=? AND created_at > ?")
      .get(req.orgId, new Date(Date.now() - 864e5).toISOString()).c,
    recent_activity: db.prepare('SELECT action,actor_email,target,created_at FROM audit_logs WHERE org_id=? ORDER BY created_at DESC LIMIT 10').all(req.orgId),
  });
});

router.get('/audit-logs', requireAuth, requirePerm('org:write'), (req, res) =>
  res.json(db.prepare('SELECT * FROM audit_logs WHERE org_id=? ORDER BY created_at DESC LIMIT 200').all(req.orgId)));

/* ================= notifications ================= */
router.get('/notifications', requireAuth, (req, res) =>
  res.json(db.prepare('SELECT * FROM notifications WHERE org_id=? ORDER BY created_at DESC LIMIT 100').all(req.orgId)));

router.post('/notifications/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE org_id=?').run(req.orgId);
  res.json({ ok: true });
});

/* ================= billing ================= */

router.get('/billing', requireAuth, (req, res) => {
  const sub = db.prepare('SELECT * FROM subscriptions WHERE org_id=?').get(req.orgId);
  const u = usage(req.orgId);
  const plan = planOf(req.org);
  res.json({
    subscription: sub, plan, usage: u, plans: PLANS,
    near_limit: u.screens >= plan.max_screens * 0.8 || u.users >= plan.max_users * 0.8,
    estimated_next_invoice: {
      currency: req.org.country === 'IN' ? 'INR' : 'USD',
      subtotal: plan.price_per_screen * u.screens,
      tax: req.org.country === 'IN' ? Math.round(plan.price_per_screen * u.screens * 0.18) : 0,
    },
    invoices: db.prepare('SELECT * FROM invoices WHERE org_id=? ORDER BY created_at DESC').all(req.orgId),
  });
});

/** Subscribe/upgrade. Payment gateway is abstracted (Stripe/Razorpay ready). */
router.post('/billing/subscribe', requireAuth, requirePerm('billing:write'), (req, res) => {
  const { plan, billing_cycle = 'monthly', payment_method = 'card', gateway = 'razorpay' } = req.body || {};
  if (!PLANS[plan]) return res.status(400).json({ error: 'unknown_plan', plans: Object.keys(PLANS) });
  if (!['monthly', 'yearly'].includes(billing_cycle)) return res.status(400).json({ error: 'bad_cycle' });
  const u = usage(req.orgId);
  if (u.screens > PLANS[plan].max_screens)
    return res.status(400).json({ error: 'downgrade_blocked_screen_count', screens: u.screens, limit: PLANS[plan].max_screens });

  const sub = db.prepare('SELECT * FROM subscriptions WHERE org_id=?').get(req.orgId);
  const renews = new Date(Date.now() + (billing_cycle === 'yearly' ? 365 : 30) * 864e5).toISOString();
  db.prepare("UPDATE subscriptions SET plan=?, billing_cycle=?, status='active', payment_method=?, screen_count=?, renews_at=? WHERE id=?")
    .run(plan, billing_cycle, `${gateway}:${payment_method}`, u.screens, renews, sub.id);
  db.prepare('UPDATE organizations SET plan_tier=? WHERE id=?').run(plan, req.orgId);
  audit(req, 'billing.subscribe', req.orgId, { plan, billing_cycle, gateway });

  const org = db.prepare('SELECT * FROM organizations WHERE id=?').get(req.orgId);
  const invoice = generateInvoice(org, db.prepare('SELECT * FROM subscriptions WHERE id=?').get(sub.id));
  db.prepare('INSERT INTO notifications (id,org_id,kind,message,read,created_at) VALUES (?,?,?,?,0,?)')
    .run(uid('ntf'), req.orgId, 'billing', `Subscribed to ${PLANS[plan].name} (${billing_cycle})`, now());
  res.json({ ok: true, subscription: db.prepare('SELECT * FROM subscriptions WHERE id=?').get(sub.id), invoice });
});

router.post('/billing/cancel', requireAuth, requirePerm('billing:write'), (req, res) => {
  db.prepare("UPDATE subscriptions SET status='canceled' WHERE org_id=?").run(req.orgId);
  audit(req, 'billing.cancel', req.orgId);
  res.json({ ok: true });
});

router.get('/billing/invoices/:id', requireAuth, (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id=? AND org_id=?').get(req.params.id, req.orgId);
  if (!inv) return res.status(404).json({ error: 'not_found' });
  const org = req.org;
  res.json({
    ...inv,
    bill_to: { organization: org.name, gstin: org.gstin, country: org.country },
    issuer: { name: 'Brandcast TV', gstin: process.env.ISSUER_GSTIN || '29AABCB1234C1ZX' },
    line_items: [{ description: `${PLANS[inv.plan]?.name || inv.plan} - ${inv.screens} screen(s)`, amount: inv.subtotal }],
  });
});
