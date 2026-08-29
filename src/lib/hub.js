import { db, uid, now } from './db.js';

/** screen_id -> Set<ws> */
const sessions = new Map();

export function register(screenId, ws) {
  if (!sessions.has(screenId)) sessions.set(screenId, new Set());
  sessions.get(screenId).add(ws);
}
export function unregister(screenId, ws) {
  const set = sessions.get(screenId);
  if (!set) return;
  set.delete(ws);
  if (!set.size) sessions.delete(screenId);
}
export const isConnected = (screenId) => (sessions.get(screenId)?.size || 0) > 0;
export const connectedCount = () => sessions.size;

export function sendTo(screenId, message) {
  const set = sessions.get(screenId);
  if (!set || !set.size) return false;
  const raw = JSON.stringify(message);
  let sent = false;
  for (const ws of set) {
    if (ws.readyState === 1) { ws.send(raw); sent = true; }
  }
  return sent;
}

/* -------- dashboard live feed -------- */
const dashboards = new Set();
export function registerDashboard(ws, orgId) { ws._orgId = orgId; dashboards.add(ws); }
export function unregisterDashboard(ws) { dashboards.delete(ws); }
export function broadcastDashboard(orgId, message) {
  const raw = JSON.stringify(message);
  for (const ws of dashboards) if (ws._orgId === orgId && ws.readyState === 1) ws.send(raw);
}

export function logStatus(screen, kind, detail) {
  db.prepare('INSERT INTO status_events (id, org_id, screen_id, kind, detail, created_at) VALUES (?,?,?,?,?,?)')
    .run(uid('st'), screen.org_id, screen.id, kind, detail || null, now());
}
