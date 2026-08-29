import { db, uid, now } from './db.js';
import * as hub from './hub.js';

/** Local wall-clock parts for a timezone. */
export function localParts(timezone, date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  const hour = p.hour === '24' ? '00' : p.hour;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${hour}:${p.minute}`, dow };
}

const inWindow = (t, start, end) =>
  start <= end ? t >= start && t <= end : t >= start || t <= end; // supports overnight

/** Specificity: screen(3) > branch(2) > org(1); ties broken by explicit priority. */
const specificity = { screen: 3, branch: 2, org: 1 };

export function activeSchedules(screen, at = new Date()) {
  const branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(screen.branch_id);
  const { date, time, dow } = localParts(branch?.timezone, at);
  const rows = db.prepare(
    `SELECT * FROM schedules WHERE org_id = ? AND enabled = 1 AND (
       (target_type='screen' AND target_id=?) OR
       (target_type='branch' AND target_id=?) OR
       (target_type='org'))`
  ).all(screen.org_id, screen.id, screen.branch_id);

  return rows.filter((s) => {
    if (s.start_date && date < s.start_date) return false;
    if (s.end_date && date > s.end_date) return false;
    if (!JSON.parse(s.days_of_week).includes(dow)) return false;
    return inWindow(time, s.start_time, s.end_time);
  }).sort((a, b) =>
    (specificity[b.target_type] - specificity[a.target_type]) ||
    (b.priority - a.priority) ||
    (a.created_at < b.created_at ? 1 : -1)
  );
}

/** Effective content for a screen: schedules win over static assignment, then branch defaults. */
export function resolveScreenContent(screen, at = new Date()) {
  const branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(screen.branch_id);
  const scheds = activeSchedules(screen, at);
  const pl = scheds.find((s) => s.content_type === 'playlist');
  const tk = scheds.find((s) => s.content_type === 'ticker');

  const playlistId = pl?.content_id || screen.playlist_id || branch?.default_playlist_id || null;
  const tickerId = tk?.content_id || screen.ticker_id || branch?.default_ticker_id || null;

  const conflicts = scheds.filter((s) => s.content_type === 'playlist').length > 1
    ? scheds.filter((s) => s.content_type === 'playlist').map((s) => ({ id: s.id, name: s.name, target_type: s.target_type }))
    : [];

  return {
    playlist_id: playlistId,
    ticker_id: tickerId,
    source: pl ? 'schedule' : 'static',
    conflicts,
    schedule_id: pl?.id || null,
  };
}

/** Full payload the TV client renders + caches. */
export function buildPayload(screen, at = new Date()) {
  const resolved = resolveScreenContent(screen, at);
  const branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(screen.branch_id);
  let playlist = null;
  if (resolved.playlist_id) {
    const p = db.prepare('SELECT * FROM playlists WHERE id = ?').get(resolved.playlist_id);
    if (p && p.status === 'approved') {
      const items = JSON.parse(p.items || '[]').map((it) => {
        const m = db.prepare('SELECT * FROM media WHERE id = ?').get(it.media_id);
        if (!m || m.status !== 'approved') return null;
        // Renditions let the TV pick a bitrate/size for its own screen and link.
        const renditions = m.renditions ? JSON.parse(m.renditions) : null;
        return {
          media_id: m.id,
          name: m.name,
          type: m.type,
          url: m.url,
          duration: it.duration || m.duration || 10,
          hls_url: renditions?.hls_url ?? null,
          poster_url: renditions?.poster_url ?? null,
          mp4: renditions?.mp4 ?? null,
          images: renditions?.variants ?? null,
        };
      }).filter(Boolean);
      playlist = { id: p.id, name: p.name, items };
    }
  }
  let ticker = null;
  if (resolved.ticker_id) {
    const t = db.prepare('SELECT * FROM tickers WHERE id = ?').get(resolved.ticker_id);
    if (t) {
      const { time } = localParts(branch?.timezone, at);
      const active = !t.start_time || !t.end_time || inWindow(time, t.start_time, t.end_time);
      if (active) ticker = { id: t.id, text: t.text, position: t.position, speed: t.speed, color: t.color, background: t.background };
    }
  }
  return {
    screen: {
      id: screen.id, name: screen.name, orientation: screen.orientation,
      branch: branch?.name || null, timezone: branch?.timezone || 'UTC',
    },
    playlist, ticker,
    source: resolved.source,
    conflicts: resolved.conflicts,
    generated_at: now(),
  };
}

/** Publish current effective content to a screen over the delivery plane. */
export function publishToScreen(screen, { actorId = null, source = 'manual' } = {}) {
  const payload = buildPayload(screen);
  const id = uid('pub');
  db.prepare(
    `INSERT INTO publish_events (id, org_id, screen_id, playlist_id, ticker_id, source, status, actor_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(id, screen.org_id, screen.id, payload.playlist?.id || null, payload.ticker?.id || null, source, 'pending', actorId, now());

  const delivered = hub.sendTo(screen.id, { type: 'content', publish_id: id, payload });
  if (delivered) {
    db.prepare("UPDATE publish_events SET status='delivered', delivered_at=? WHERE id=?").run(now(), id);
  }
  hub.broadcastDashboard(screen.org_id, {
    type: 'publish', screen_id: screen.id, publish_id: id, status: delivered ? 'delivered' : 'pending',
  });
  return { publish_id: id, delivered, payload };
}

export function publishToScreens(screens, opts) {
  return screens.map((s) => ({ screen_id: s.id, ...publishToScreen(s, opts) }));
}
