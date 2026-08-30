// SOT: delivery-plane, websocket-hub, screen-sessions, presence
// WHAT:  routes a message to a screen's socket, wherever in the fleet that socket is.
// WHY:   a publish issued on the node handling the dashboard request usually has to
//        reach a TV parked on a different node.
// HOW:   sockets stay local; the bus carries the routing. This node subscribes to a
//        screen's topic only while it holds that screen's socket, so a publish lands
//        on exactly one node. Presence across nodes is read from the shared database
//        (heartbeats already write last_seen_at) rather than a second store.
// WHERE: bus drivers in src/lib/bus.ts; socket lifecycle in src/server.ts

import { eq } from 'drizzle-orm';
import type { WebSocket } from 'ws';
import { db } from '../db/client.js';
import { screens, statusEvents } from '../db/schema.js';
import type { Screen } from '../db/schema.js';
import * as bus from './bus.js';
import { now, uid } from './ids.js';

/** screen_id -> sockets held by *this* node */
const sessions = new Map<string, Set<WebSocket>>();
/** screen_id -> bus handler, so unsubscribe removes the right listener */
const screenHandlers = new Map<string, bus.BusHandler>();

const OFFLINE_AFTER_MS = Number(process.env.OFFLINE_AFTER_MS ?? 90_000);
const fresh = (iso: string | null): boolean =>
  !!iso && Date.now() - Date.parse(iso) < OFFLINE_AFTER_MS;

const OPEN = 1;

/** Write to every open local socket for a screen. Returns whether any took it. */
function deliverLocal(screenId: string, message: unknown): boolean {
  const set = sessions.get(screenId);
  if (!set?.size) return false;
  const raw = JSON.stringify(message);
  let sent = false;
  for (const ws of set) {
    if (ws.readyState === OPEN) { ws.send(raw); sent = true; }
  }
  return sent;
}

export async function register(screenId: string, ws: WebSocket): Promise<void> {
  let set = sessions.get(screenId);
  if (!set) {
    set = new Set();
    sessions.set(screenId, set);
    if (bus.distributed()) {
      // Subscribed only while this node holds the socket, so a publish routes to
      // the one node that can deliver it.
      const handler: bus.BusHandler = (msg) => {
        if (msg.node === bus.NODE_ID) return;
        deliverLocal(screenId, msg.message);
      };
      screenHandlers.set(screenId, handler);
      await bus.subscribe(bus.topics.screen(screenId), handler);
    }
  }
  set.add(ws);
}

export async function unregister(screenId: string, ws: WebSocket): Promise<void> {
  const set = sessions.get(screenId);
  if (!set) return;
  set.delete(ws);
  if (set.size) return;
  sessions.delete(screenId);
  const handler = screenHandlers.get(screenId);
  if (handler) {
    screenHandlers.delete(screenId);
    await bus.unsubscribe(bus.topics.screen(screenId), handler).catch(() => {});
  }
}

/** Sockets this node is holding. Fleet-wide counts come from the screens table. */
export const connectedCount = (): number => sessions.size;
export const isConnectedLocally = (screenId: string): boolean =>
  (sessions.get(screenId)?.size ?? 0) > 0;

/**
 * Is the screen live anywhere? Local sockets are authoritative for this node; for
 * the rest of the fleet a fresh heartbeat in the shared database is the signal.
 */
export async function isConnected(screenId: string): Promise<boolean> {
  if (isConnectedLocally(screenId)) return true;
  if (!bus.distributed()) return false;
  const row = await db.select({ status: screens.status, last_seen_at: screens.last_seen_at })
    .from(screens).where(eq(screens.id, screenId)).limit(1);
  const s = row[0];
  return !!s && s.status === 'online' && fresh(s.last_seen_at);
}

/** Deliver to a screen, crossing nodes when it is not parked here. */
export async function sendTo(screenId: string, message: unknown): Promise<boolean> {
  if (deliverLocal(screenId, message)) return true;
  if (!bus.distributed()) return false;
  await bus.publish(bus.topics.screen(screenId), message);
  // The device's own ack is the real confirmation; presence is the best answer
  // available at this instant.
  return isConnected(screenId);
}

/* -------- dashboard live feed -------- */

const dashboards = new Set<WebSocket & { _orgId?: string }>();
/** org_id -> the org topic subscription this node currently needs */
const orgSubs = new Map<string, { count: number; handler: bus.BusHandler }>();

export async function registerDashboard(ws: WebSocket, orgId: string): Promise<void> {
  const socket = ws as WebSocket & { _orgId?: string };
  socket._orgId = orgId;
  dashboards.add(socket);
  if (!orgId || !bus.distributed()) return;
  const existing = orgSubs.get(orgId);
  if (existing) { existing.count++; return; }
  const handler: bus.BusHandler = (msg) => {
    if (msg.node === bus.NODE_ID) return;
    deliverDashboards(orgId, msg.message);
  };
  orgSubs.set(orgId, { count: 1, handler });
  await bus.subscribe(bus.topics.org(orgId), handler);
}

export async function unregisterDashboard(ws: WebSocket): Promise<void> {
  const socket = ws as WebSocket & { _orgId?: string };
  if (!dashboards.delete(socket)) return;
  const orgId = socket._orgId;
  const entry = orgId ? orgSubs.get(orgId) : undefined;
  if (!orgId || !entry) return;
  entry.count--;
  if (entry.count > 0) return;
  orgSubs.delete(orgId);
  await bus.unsubscribe(bus.topics.org(orgId), entry.handler).catch(() => {});
}

function deliverDashboards(orgId: string, message: unknown): void {
  const raw = JSON.stringify(message);
  for (const ws of dashboards) {
    if (ws._orgId === orgId && ws.readyState === OPEN) ws.send(raw);
  }
}

/** Every dashboard for the org, on this node and the rest of the fleet. */
export async function broadcastDashboard(orgId: string, message: unknown): Promise<void> {
  deliverDashboards(orgId, message);
  if (bus.distributed()) await bus.publish(bus.topics.org(orgId), message);
}

/** The uptime series is derived from these rows, so every transition is recorded. */
export async function logStatus(
  screen: Pick<Screen, 'id' | 'org_id'>, kind: string, detail?: string,
): Promise<void> {
  await db.insert(statusEvents).values({
    id: uid('st'),
    org_id: screen.org_id,
    screen_id: screen.id,
    kind,
    detail: detail ?? null,
    created_at: now(),
  });
}
