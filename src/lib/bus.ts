// SOT: message-bus, pubsub-driver, fanout, multi-node-delivery
// WHAT:  the pub/sub fabric the delivery plane uses to reach a screen that is
//        connected to a different app node.
// WHY:   one process can hold a few thousand sockets. Tens of thousands of screens
//        means several nodes, and a publish issued on node A has to reach the socket
//        parked on node B.
// HOW:   one topic per screen and one per org, subscribed only while this node
//        actually holds a socket for it, so a message is routed to the one node that
//        can deliver it rather than broadcast to the whole fleet.
// WHERE: consumed by src/lib/hub.ts; driver picked by REDIS_URL / MQTT_URL.

import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

/** Identifies this process in bus messages so a node ignores its own echo. */
export const NODE_ID = process.env.NODE_ID || `node_${crypto.randomBytes(6).toString('hex')}`;

const REDIS_URL = process.env.REDIS_URL || '';
const MQTT_URL = process.env.MQTT_URL || '';

const configured = (
  process.env.BUS_DRIVER || (REDIS_URL ? 'redis' : MQTT_URL ? 'mqtt' : 'memory')
).toLowerCase();

export type BusDriver = 'memory' | 'redis' | 'mqtt';

/** What travels over a topic: the payload plus the node that sent it. */
export type BusMessage = { node: string; message: unknown };
export type BusHandler = (msg: BusMessage) => void;

export const topics = {
  screen: (screenId: string) => `bc/screen/${screenId}`,
  org: (orgId: string) => `bc/org/${orgId}`,
};

type Impl = {
  name: BusDriver;
  subscribe(topic: string, handler: BusHandler): Promise<void>;
  unsubscribe(topic: string, handler: BusHandler): Promise<void>;
  publish(topic: string, message: BusMessage): Promise<void>;
  close(): Promise<void>;
};

let impl: Impl | null = null;
let activeDriver: BusDriver = 'memory';

/** True when messages can cross process boundaries. */
export const distributed = (): boolean => activeDriver !== 'memory';
export const driver = (): BusDriver => activeDriver;

/* ------------------------------------------------------------------ *
 * Drivers
 * ------------------------------------------------------------------ */

/** Single process. Same semantics, no infrastructure — this is the demo path. */
function memoryDriver(): Impl {
  const bus = new EventEmitter();
  bus.setMaxListeners(0);
  return {
    name: 'memory',
    async subscribe(topic, handler) { bus.on(topic, handler); },
    async unsubscribe(topic, handler) { bus.off(topic, handler); },
    async publish(topic, message) { bus.emit(topic, message); },
    async close() { bus.removeAllListeners(); },
  };
}

async function redisDriver(): Promise<Impl> {
  const { createClient } = await import('redis');
  const pub = createClient({ url: REDIS_URL });
  // Redis puts a connection into subscriber mode, where it accepts nothing else,
  // so publishing and subscribing need two clients.
  const sub = pub.duplicate();
  for (const client of [pub, sub]) client.on('error', (e: Error) => console.error('[bus] redis', e.message));
  await pub.connect();
  await sub.connect();

  // Redis hands the callback a raw string; keep one wrapper per handler so
  // unsubscribe removes exactly the listener that was added.
  const wrappers = new Map<BusHandler, (raw: string) => void>();

  return {
    name: 'redis',
    async subscribe(topic, handler) {
      const wrapped = (raw: string) => {
        try { handler(JSON.parse(raw) as BusMessage); } catch { /* not one of ours */ }
      };
      wrappers.set(handler, wrapped);
      await sub.subscribe(topic, wrapped);
    },
    async unsubscribe(topic, handler) {
      const wrapped = wrappers.get(handler);
      wrappers.delete(handler);
      await sub.unsubscribe(topic, wrapped);
    },
    async publish(topic, message) { await pub.publish(topic, JSON.stringify(message)); },
    async close() { await Promise.allSettled([sub.quit(), pub.quit()]); },
  };
}

async function mqttDriver(): Promise<Impl> {
  const mqtt = (await import('mqtt')).default;
  const client = await new Promise<Awaited<ReturnType<typeof mqtt.connectAsync>>>((resolve, reject) => {
    const c = mqtt.connect(MQTT_URL, {
      clientId: `brandcast-${NODE_ID}`,
      clean: true,
      reconnectPeriod: 2000,
      ...(process.env.MQTT_USERNAME ? { username: process.env.MQTT_USERNAME } : {}),
      ...(process.env.MQTT_PASSWORD ? { password: process.env.MQTT_PASSWORD } : {}),
    });
    c.once('connect', () => resolve(c));
    c.once('error', reject);
  });

  // One MQTT connection carries every topic, so dispatch by topic on arrival.
  const handlers = new Map<string, Set<BusHandler>>();
  client.on('message', (topic: string, buf: Buffer) => {
    const set = handlers.get(topic);
    if (!set) return;
    let message: BusMessage;
    try { message = JSON.parse(buf.toString()) as BusMessage; } catch { return; }
    for (const h of set) h(message);
  });

  return {
    name: 'mqtt',
    async subscribe(topic, handler) {
      let set = handlers.get(topic);
      if (!set) {
        set = new Set();
        handlers.set(topic, set);
        await client.subscribeAsync(topic, { qos: 1 });
      }
      set.add(handler);
    },
    async unsubscribe(topic, handler) {
      const set = handlers.get(topic);
      if (!set) return;
      set.delete(handler);
      if (!set.size) { handlers.delete(topic); await client.unsubscribeAsync(topic); }
    },
    async publish(topic, message) {
      await client.publishAsync(topic, JSON.stringify(message), { qos: 1 });
    },
    async close() { await client.endAsync(); },
  };
}

/* ------------------------------------------------------------------ *
 * Public surface
 * ------------------------------------------------------------------ */

/**
 * Connect the configured driver. A broker that will not come up degrades to the
 * in-process bus rather than taking the node down: one node serving its own screens
 * beats no node at all.
 */
export async function initBus(): Promise<{ driver: BusDriver; node_id: string }> {
  if (!impl) {
    try {
      if (configured === 'redis' && REDIS_URL) impl = await redisDriver();
      else if (configured === 'mqtt' && MQTT_URL) impl = await mqttDriver();
      else impl = memoryDriver();
    } catch (err) {
      console.warn(`[bus] ${configured} unavailable (${(err as Error).message}); falling back to in-process`);
      impl = memoryDriver();
    }
    activeDriver = impl.name;
  }
  return { driver: activeDriver, node_id: NODE_ID };
}

function ready(): Impl {
  if (!impl) { impl = memoryDriver(); activeDriver = impl.name; }
  return impl;
}

export const subscribe = (topic: string, handler: BusHandler): Promise<void> =>
  ready().subscribe(topic, handler);
export const unsubscribe = (topic: string, handler: BusHandler): Promise<void> =>
  ready().unsubscribe(topic, handler);

/** Stamped with the origin so a node can drop the copy it published itself. */
export const publish = (topic: string, message: unknown): Promise<void> =>
  ready().publish(topic, { node: NODE_ID, message });

export async function closeBus(): Promise<void> {
  if (!impl) return;
  await impl.close();
  impl = null;
  activeDriver = 'memory';
}
