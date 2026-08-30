/* The production paths the other suites do not reach:
   gateway webhook verification, and delivery across two app nodes over Redis. */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import WebSocket from 'ws';
import { createTestDatabase, startServer } from './helpers/postgres.js';

const STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
const PORT_A = 4331;
const PORT_B = 4332;
const BASE_A = `http://127.0.0.1:${PORT_A}`;

// Defaults to the compose Redis; the fan-out tests skip when it is unreachable.
const REDIS_URL = process.env.TEST_REDIS_URL || process.env.REDIS_URL || 'redis://127.0.0.1:6380';

/** Redis is optional for the rest of the suite, so the fan-out tests skip without it. */
const redisReachable = await (async () => {
  try {
    const { createClient } = await import('redis');
    const client = createClient({ url: REDIS_URL, socket: { connectTimeout: 1500 } });
    client.on('error', () => {});
    await client.connect();
    await client.ping();
    await client.quit();
    return true;
  } catch { return false; }
})();

const database = await createTestDatabase('prod');

// Two nodes, one database, one bus: exactly the shape a fleet has.
const nodeA = await startServer({
  label: 'prod', port: PORT_A, database,
  env: {
    DISABLE_RATE_LIMIT: '1',
    STRIPE_WEBHOOK_SECRET,
    ...(redisReachable ? { REDIS_URL } : {}),
  },
});
const nodeB = redisReachable
  ? await startServer({
      label: 'prod', port: PORT_B, database,
      env: { DISABLE_RATE_LIMIT: '1', REDIS_URL },
    })
  : null;

test.after(async () => {
  await nodeB?.stop();
  await nodeA?.stop();
  await database.drop().catch(() => {});
});


const call = async (base, p, { method = 'GET', body, token } = {}) => {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(`${base}/api${p}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

const ctx = {};

test('setup: a tenant with an owner', async () => {
  const r = await call(BASE_A, '/auth/signup', { method: 'POST', body: {
    name: 'Ops', email: `prod${Date.now()}@test.com`, password: 'password123', org_name: 'Fleet Co',
  } });
  assert.equal(r.status, 201);
  ctx.owner = r.data.token;
  ctx.orgId = r.data.org_id;
});

/* ---------------- gateway webhooks ---------------- */

/** Stripe signs `${timestamp}.${body}`; the timestamp is inside the signed data. */
const stripeSignature = (body, timestamp = Math.floor(Date.now() / 1000)) => {
  const v1 = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET)
    .update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
};

const postWebhook = (body, signature) =>
  fetch(`${BASE_A}/api/billing/webhooks/stripe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body,
  });

const checkoutCompleted = (orgId, id) => JSON.stringify({
  id,
  type: 'checkout.session.completed',
  data: {
    object: {
      object: 'checkout.session',
      id: 'cs_test_1',
      client_reference_id: orgId,
      customer: 'cus_test_1',
      subscription: 'sub_test_1',
      metadata: { org_id: orgId, plan: 'growth', billing_cycle: 'monthly' },
    },
  },
});

test('a webhook with no signature is refused', async () => {
  const res = await fetch(`${BASE_A}/api/billing/webhooks/stripe`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_signature');
});

test('a forged signature is refused', async () => {
  const body = checkoutCompleted(ctx.orgId, 'evt_forged');
  const res = await postWebhook(body, stripeSignature('a different body'));
  assert.equal(res.status, 400);
});

test('a replayed timestamp outside the tolerance is refused', async () => {
  const body = checkoutCompleted(ctx.orgId, 'evt_old');
  // Correctly signed, but signed an hour ago: a captured request must not work.
  const old = Math.floor(Date.now() / 1000) - 3600;
  const res = await postWebhook(body, stripeSignature(body, old));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).detail, 'signature_too_old');
});

test('a signed checkout.session.completed activates the subscription', async () => {
  const before = await call(BASE_A, '/billing', { token: ctx.owner });
  assert.equal(before.data.subscription.status, 'trialing', 'starts on the trial');

  const body = checkoutCompleted(ctx.orgId, 'evt_ok_1');
  const res = await postWebhook(body, stripeSignature(body));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).applied, 'subscription.active');

  const after = await call(BASE_A, '/billing', { token: ctx.owner });
  assert.equal(after.data.subscription.status, 'active');
  assert.equal(after.data.subscription.plan, 'growth');
  assert.equal(after.data.subscription.gateway, 'stripe');
  assert.equal(after.data.subscription.gateway_subscription_id, 'sub_test_1');
  const me = await call(BASE_A, '/auth/me', { token: ctx.owner });
  assert.equal(me.data.org.plan_tier, 'growth', 'the plan the org is on follows the payment');
});

test('redelivering the same event changes nothing', async () => {
  const body = checkoutCompleted(ctx.orgId, 'evt_ok_1');
  const res = await postWebhook(body, stripeSignature(body));
  // 200 so the gateway stops retrying, but the event is not applied twice.
  assert.equal(res.status, 200);
  assert.equal((await res.json()).duplicate, true);
});

test('a payment failure moves the subscription to past_due', async () => {
  const body = JSON.stringify({
    id: 'evt_failed_1',
    type: 'invoice.payment_failed',
    data: { object: { object: 'invoice', id: 'in_1', subscription: 'sub_test_1' } },
  });
  const res = await postWebhook(body, stripeSignature(body));
  assert.equal(res.status, 200);
  const billing = await call(BASE_A, '/billing', { token: ctx.owner });
  assert.equal(billing.data.subscription.status, 'past_due');
});

test('an unknown gateway is a 404, not a signature error', async () => {
  const res = await fetch(`${BASE_A}/api/billing/webhooks/paypal`, { method: 'POST', body: '{}' });
  assert.equal(res.status, 404);
});

/* ---------------- cross-node delivery ---------------- */

test('both nodes report the same bus driver', { skip: !redisReachable && 'redis unreachable' }, async () => {
  for (const base of [BASE_A, `http://127.0.0.1:${PORT_B}`]) {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.bus, 'redis');
    assert.equal(health.database, 'postgres');
  }
  const a = await (await fetch(`${BASE_A}/api/health`)).json();
  const b = await (await fetch(`http://127.0.0.1:${PORT_B}/api/health`)).json();
  assert.notEqual(a.node_id, b.node_id, 'the two nodes are distinct processes');
});

test('a publish on one node reaches a screen connected to another', {
  skip: !redisReachable && 'redis unreachable',
}, async () => {
  const BASE_B = `http://127.0.0.1:${PORT_B}`;

  const branches = await call(BASE_A, '/branches', { token: ctx.owner });
  const branchId = branches.data[0].id;

  const media = await call(BASE_A, '/media/link', { method: 'POST', token: ctx.owner, body: {
    name: 'Fan-out card', url: 'https://cdn.example/card.png', type: 'image',
  } });
  const playlist = await call(BASE_A, '/playlists', { method: 'POST', token: ctx.owner, body: {
    name: 'Fan-out loop', items: [{ media_id: media.data.id, duration: 5 }],
  } });

  const otp = await call(BASE_A, '/pairing/generate-otp', { method: 'POST', body: { device_id: 'dev-fanout' } });
  const screen = await call(BASE_A, '/screens', { method: 'POST', token: ctx.owner, body: {
    code: otp.data.code, name: 'Fan-out Screen', branch_id: branchId,
  } });
  const paired = await call(BASE_A, `/pairing/status/${otp.data.code}?device_id=dev-fanout`);
  const deviceToken = paired.data.device_token;

  // The device's socket lives on node A, and only on node A.
  const ws = new WebSocket(`ws://127.0.0.1:${PORT_A}/device/session?token=${deviceToken}`);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  // Drain the payload sent on connect, so the next one is the publish under test.
  await new Promise((resolve) => ws.once('message', resolve));

  const delivered = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no content arrived from the other node')), 8000);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type !== 'content') return;
      clearTimeout(timer);
      resolve(msg);
    });
  });

  // Assign and publish from node B, which holds no socket for this screen at all.
  const published = await call(BASE_B, `/screens/${screen.data.id}`, {
    method: 'PATCH', token: ctx.owner, body: { playlist_id: playlist.data.id },
  });
  assert.equal(published.status, 200);

  const msg = await delivered;
  assert.equal(msg.payload.playlist.id, playlist.data.id, 'the routed payload is the new playlist');
  assert.equal(msg.payload.playlist.items[0].media_id, media.data.id);
  assert.equal(published.data.publish.delivered, true, 'node B knows the screen is reachable');

  ws.close();
});
