import express from 'express';
import { db, uid, now } from '../lib/db.js';
import { requireAuth, requirePerm, audit } from '../lib/auth.js';
import { requireFeature } from '../lib/plans.js';
import { activeSchedules, resolveScreenContent, localParts } from '../lib/content.js';
import { schedulerTick } from '../lib/jobs.js';

export const router = express.Router();

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

router.get('/schedules', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM schedules WHERE org_id=? ORDER BY created_at DESC').all(req.orgId);
  res.json(rows.map((s) => ({ ...s, days_of_week: JSON.parse(s.days_of_week), enabled: !!s.enabled })));
});

router.post('/schedules', requireAuth, requirePerm('content:publish'), requireFeature('scheduling'), (req, res) => {
  const {
    name, target_type = 'org', target_id = null, content_type = 'playlist', content_id,
    start_date = null, end_date = null, start_time = '00:00', end_time = '23:59',
    days_of_week = [0, 1, 2, 3, 4, 5, 6], priority = 0,
  } = req.body || {};

  if (!name || !content_id) return res.status(400).json({ error: 'name and content_id required' });
  if (!['screen', 'branch', 'org'].includes(target_type)) return res.status(400).json({ error: 'bad_target_type' });
  if (target_type !== 'org' && !target_id) return res.status(400).json({ error: 'target_id required' });
  if (!HHMM.test(start_time) || !HHMM.test(end_time)) return res.status(400).json({ error: 'times must be HH:MM' });
  if (start_date && !DATE.test(start_date)) return res.status(400).json({ error: 'bad start_date' });
  if (end_date && !DATE.test(end_date)) return res.status(400).json({ error: 'bad end_date' });
  if (!Array.isArray(days_of_week) || days_of_week.some((d) => d < 0 || d > 6))
    return res.status(400).json({ error: 'bad days_of_week' });

  const table = content_type === 'ticker' ? 'tickers' : 'playlists';
  if (!db.prepare(`SELECT 1 FROM ${table} WHERE id=? AND org_id=?`).get(content_id, req.orgId))
    return res.status(400).json({ error: 'content_not_found' });
  if (target_type === 'screen' && !db.prepare('SELECT 1 FROM screens WHERE id=? AND org_id=?').get(target_id, req.orgId))
    return res.status(400).json({ error: 'screen_not_found' });
  if (target_type === 'branch' && !db.prepare('SELECT 1 FROM branches WHERE id=? AND org_id=?').get(target_id, req.orgId))
    return res.status(400).json({ error: 'branch_not_found' });

  const id = uid('sch');
  db.prepare(
    `INSERT INTO schedules (id,org_id,name,target_type,target_id,content_type,content_id,start_date,end_date,start_time,end_time,days_of_week,priority,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, req.orgId, name, target_type, target_id, content_type, content_id,
        start_date, end_date, start_time, end_time, JSON.stringify(days_of_week), priority, now());
  audit(req, 'schedule.create', id, { name, target_type });
  schedulerTick();

  const created = db.prepare('SELECT * FROM schedules WHERE id=?').get(id);
  res.status(201).json({ ...created, days_of_week: JSON.parse(created.days_of_week), conflicts: conflictsFor(created) });
});

/** Overlapping schedules on the same targets/content type. */
function conflictsFor(s) {
  const others = db.prepare(
    'SELECT * FROM schedules WHERE org_id=? AND id != ? AND content_type=? AND enabled=1'
  ).all(s.org_id, s.id, s.content_type);
  const days = JSON.parse(s.days_of_week);
  return others.filter((o) => {
    const sameScope = o.target_type === 'org' || s.target_type === 'org' ||
      (o.target_type === s.target_type && o.target_id === s.target_id);
    if (!sameScope) return false;
    if (!JSON.parse(o.days_of_week).some((d) => days.includes(d))) return false;
    return s.start_time <= o.end_time && o.start_time <= s.end_time;
  }).map((o) => ({
    id: o.id, name: o.name, target_type: o.target_type,
    resolution: rankOf(s) >= rankOf(o) ? 'this_schedule_wins' : 'other_schedule_wins',
  }));
}
const rank = { screen: 3, branch: 2, org: 1 };
const rankOf = (s) => rank[s.target_type] * 1000 + s.priority;

router.patch('/schedules/:id', requireAuth, requirePerm('content:publish'), (req, res) => {
  const s = db.prepare('SELECT * FROM schedules WHERE id=? AND org_id=?').get(req.params.id, req.orgId);
  if (!s) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  if (b.start_time && !HHMM.test(b.start_time)) return res.status(400).json({ error: 'bad start_time' });
  if (b.end_time && !HHMM.test(b.end_time)) return res.status(400).json({ error: 'bad end_time' });
  db.prepare(
    `UPDATE schedules SET name=?,content_id=?,start_date=?,end_date=?,start_time=?,end_time=?,days_of_week=?,priority=?,enabled=? WHERE id=?`
  ).run(b.name ?? s.name, b.content_id ?? s.content_id,
        b.start_date === undefined ? s.start_date : b.start_date,
        b.end_date === undefined ? s.end_date : b.end_date,
        b.start_time ?? s.start_time, b.end_time ?? s.end_time,
        b.days_of_week ? JSON.stringify(b.days_of_week) : s.days_of_week,
        b.priority ?? s.priority, b.enabled === undefined ? s.enabled : (b.enabled ? 1 : 0), s.id);
  audit(req, 'schedule.update', s.id, b);
  schedulerTick();
  res.json(db.prepare('SELECT * FROM schedules WHERE id=?').get(s.id));
});

router.delete('/schedules/:id', requireAuth, requirePerm('content:publish'), (req, res) => {
  const s = db.prepare('SELECT * FROM schedules WHERE id=? AND org_id=?').get(req.params.id, req.orgId);
  if (!s) return res.status(404).json({ error: 'not_found' });
  db.prepare('DELETE FROM schedules WHERE id=?').run(s.id);
  audit(req, 'schedule.delete', s.id);
  schedulerTick();
  res.json({ ok: true });
});

/** What a screen will show now (and which schedules are active). */
router.get('/schedules/preview/:screen_id', requireAuth, (req, res) => {
  const s = db.prepare('SELECT * FROM screens WHERE id=? AND org_id=?').get(req.params.screen_id, req.orgId);
  if (!s) return res.status(404).json({ error: 'not_found' });
  const at = req.query.at ? new Date(req.query.at) : new Date();
  if (Number.isNaN(at.getTime())) return res.status(400).json({ error: 'bad at' });
  const branch = db.prepare('SELECT * FROM branches WHERE id=?').get(s.branch_id);
  res.json({
    at: at.toISOString(),
    local: localParts(branch?.timezone, at),
    timezone: branch?.timezone,
    active: activeSchedules(s, at).map((x) => ({ id: x.id, name: x.name, target_type: x.target_type, content_type: x.content_type })),
    resolved: resolveScreenContent(s, at),
  });
});

router.post('/schedules/run', requireAuth, requirePerm('content:publish'), (req, res) =>
  res.json({ ok: true, republished: schedulerTick() }));
