import { db, now, uid } from './db.js';
import * as hub from './hub.js';
import { buildPayload, publishToScreen } from './content.js';
import { PLANS } from './plans.js';

const lastPayload = new Map(); // screen_id -> fingerprint

const fingerprint = (p) => JSON.stringify({
  pl: p.playlist?.id || null,
  items: (p.playlist?.items || []).map((i) => [i.media_id, i.duration]),
  tk: p.ticker ? [p.ticker.id, p.ticker.text, p.ticker.position] : null,
});

/** Re-publish screens whose scheduled content changed (daypart rotation, expiry). */
export function schedulerTick() {
  const screens = db.prepare("SELECT * FROM screens WHERE device_token IS NOT NULL").all();
  let changed = 0;
  for (const s of screens) {
    const fp = fingerprint(buildPayload(s));
    if (lastPayload.get(s.id) !== fp) {
      if (lastPayload.has(s.id)) { publishToScreen(s, { source: 'schedule' }); changed++; }
      lastPayload.set(s.id, fp);
    }
  }
  return changed;
}

const OFFLINE_AFTER_MS = Number(process.env.OFFLINE_AFTER_MS || 90_000);

/** Mark stale screens offline and raise alerts. */
export function healthTick() {
  const screens = db.prepare("SELECT * FROM screens WHERE device_token IS NOT NULL").all();
  for (const s of screens) {
    const connected = hub.isConnected(s.id);
    const stale = !s.last_seen_at || (Date.now() - Date.parse(s.last_seen_at)) > OFFLINE_AFTER_MS;
    const shouldBe = connected && !stale ? 'online' : 'offline';
    if (shouldBe !== s.status) {
      db.prepare('UPDATE screens SET status = ? WHERE id = ?').run(shouldBe, s.id);
      hub.logStatus(s, shouldBe);
      hub.broadcastDashboard(s.org_id, { type: 'screen_status', screen_id: s.id, status: shouldBe });
      db.prepare('INSERT INTO notifications (id, org_id, kind, message, read, created_at) VALUES (?,?,?,?,0,?)')
        .run(uid('ntf'), s.org_id, shouldBe === 'offline' ? 'screen_offline' : 'screen_online',
             `Screen "${s.name}" is ${shouldBe}`, now());
    }
  }
}

/** Monthly invoice generation for active subscriptions past renewal. */
export function billingTick() {
  const subs = db.prepare("SELECT * FROM subscriptions WHERE status IN ('active','trialing')").all();
  for (const sub of subs) {
    if (!sub.renews_at || Date.parse(sub.renews_at) > Date.now()) continue;
    if (sub.status === 'trialing') { db.prepare("UPDATE subscriptions SET status='past_due' WHERE id=?").run(sub.id); continue; }
    const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(sub.org_id);
    if (org) generateInvoice(org, sub);
  }
}

export function generateInvoice(org, sub) {
  const plan = PLANS[sub.plan] || PLANS.trial;
  const screens = db.prepare('SELECT COUNT(*) c FROM screens WHERE org_id = ?').get(org.id).c;
  const cycles = sub.billing_cycle === 'yearly' ? 12 * 0.85 : 1;
  const subtotal = Math.round(plan.price_per_screen * screens * cycles);
  const taxRate = org.country === 'IN' ? 0.18 : 0;
  const tax = Math.round(subtotal * taxRate);
  const start = now();
  const end = new Date(Date.now() + (sub.billing_cycle === 'yearly' ? 365 : 30) * 864e5).toISOString();
  const id = uid('inv');
  db.prepare(
    `INSERT INTO invoices (id, org_id, number, plan, screens, currency, subtotal, tax, tax_label, total, status, period_start, period_end, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, org.id, `BC-${new Date().getFullYear()}-${id.slice(-6).toUpperCase()}`, sub.plan, screens,
        org.country === 'IN' ? 'INR' : 'USD', subtotal, tax, taxRate ? 'GST 18%' : 'No tax',
        subtotal + tax, subtotal === 0 ? 'paid' : 'paid', start, end, now());
  db.prepare('UPDATE subscriptions SET screen_count=?, renews_at=? WHERE id=?').run(screens, end, sub.id);
  return db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
}

export function startJobs() {
  const t1 = setInterval(schedulerTick, Number(process.env.SCHEDULER_MS || 15_000));
  const t2 = setInterval(healthTick, Number(process.env.HEALTH_MS || 30_000));
  const t3 = setInterval(billingTick, 60 * 60 * 1000);
  for (const t of [t1, t2, t3]) t.unref?.();
  return () => [t1, t2, t3].forEach(clearInterval);
}
