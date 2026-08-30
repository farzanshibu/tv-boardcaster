/*
 * Seeds a realistic demo tenant plus the platform superadmin.
 * Everything lands in one transaction: a half-seeded tenant is harder to reason about
 * than an empty database.
 */
import { db, closeDb, runMigrations } from '../src/db/client.js';
import {
  branches, media, organizations, playlists, schedules, screens, subscriptions, tickers, users,
} from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { hash } from '../src/lib/auth.js';
import { now, uid } from '../src/lib/ids.js';

await runMigrations();

/** Demo artwork as an inline SVG data URI: no binaries in the repo, no upload step. */
const svg = (bg: [string, string], text: string, sub: string): string =>
  'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">
   <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
   <stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></linearGradient></defs>
   <rect width="1920" height="1080" fill="url(#g)"/>
   <text x="960" y="500" font-family="Helvetica" font-size="140" font-weight="bold" fill="#fff" text-anchor="middle">${text}</text>
   <text x="960" y="620" font-family="Helvetica" font-size="60" fill="#ffffffcc" text-anchor="middle">${sub}</text></svg>`);

const orgId = uid('org');
const ts = now();

await db.transaction(async (tx) => {
  // Platform superadmin belongs to no tenant, and only ever needs creating once.
  const existing = await tx.query.users.findFirst({ where: eq(users.role, 'superadmin') });
  if (!existing) {
    await tx.insert(users).values({
      id: uid('usr'), org_id: null, name: 'Platform Ops',
      email: 'superadmin@brandcast.tv', password_hash: hash('superadmin123'),
      role: 'superadmin', created_at: ts,
    });
  }

  await tx.insert(organizations).values({
    id: orgId, name: 'Acme Retail India', plan_tier: 'growth',
    country: 'IN', gstin: '29AABCA1234C1ZX', created_at: ts,
  });

  const branchIds: string[] = [];
  for (const [name, timezone] of [
    ['Koramangala Store', 'Asia/Kolkata'],
    ['Andheri West Store', 'Asia/Kolkata'],
    ['Dubai Mall Kiosk', 'Asia/Dubai'],
  ] as const) {
    const id = uid('brn');
    await tx.insert(branches).values({ id, org_id: orgId, name, timezone, created_at: ts });
    branchIds.push(id);
  }

  const userIds: string[] = [];
  for (const [name, email, role] of [
    ['Arjun Mehta', 'owner@acme.test', 'owner'],
    ['Priya Nair', 'admin@acme.test', 'admin'],
    ['Riya Sharma', 'manager@acme.test', 'branch_manager'],
    ['Dev Kapoor', 'editor@acme.test', 'content_editor'],
    ['Neha Rao', 'viewer@acme.test', 'viewer'],
  ] as const) {
    const id = uid('usr');
    await tx.insert(users).values({
      id, org_id: orgId, name, email, password_hash: hash('password123'), role,
      // The branch manager is deliberately scoped to one store, so RBAC is visible.
      branch_ids: role === 'branch_manager' ? JSON.stringify([branchIds[0]]) : '[]',
      created_at: ts,
    });
    userIds.push(id);
  }

  const mediaIds: string[] = [];
  for (const [name, bg, title, sub] of [
    ['Diwali Mega Sale', ['#f97316', '#b91c1c'], 'DIWALI SALE', 'Up to 50% off'],
    ['Breakfast Combo', ['#0ea5e9', '#1e40af'], 'BREAKFAST', '₹99 combo till 11am'],
    ['Lunch Special', ['#16a34a', '#065f46'], 'LUNCH', 'Thali at ₹199'],
    ['New Arrivals', ['#8b5cf6', '#4c1d95'], 'NEW IN', 'Autumn collection'],
    ['Store Compliance Notice', ['#334155', '#0f172a'], 'NOTICE', 'CCTV in operation'],
  ] as [string, [string, string], string, string][]) {
    const id = uid('med');
    await tx.insert(media).values({
      id, org_id: orgId, name, type: 'image', url: svg(bg, title, sub),
      duration: 8, tags: JSON.stringify(['demo']), status: 'approved',
      created_by: userIds[0]!, created_at: ts,
    });
    mediaIds.push(id);
  }

  const makePlaylist = async (name: string, picks: number[]): Promise<string> => {
    const id = uid('pls');
    await tx.insert(playlists).values({
      id, org_id: orgId, name,
      items: JSON.stringify(picks.map((i) => ({ media_id: mediaIds[i], duration: 8 }))),
      status: 'approved', created_at: ts, updated_at: ts,
    });
    return id;
  };
  const alwaysOn = await makePlaylist('Always-On Brand Loop', [0, 3, 4]);
  const breakfast = await makePlaylist('Breakfast Daypart', [1, 4]);
  const lunch = await makePlaylist('Lunch Daypart', [2, 0]);

  const tickerId = uid('tkr');
  await tx.insert(tickers).values({
    id: tickerId, org_id: orgId, name: 'Store Hours & Offers',
    text: 'Welcome to Acme Retail  •  Store open 9am – 10pm  •  Members get 10% extra off today  •  Ask staff about our loyalty program',
    position: 'bottom', speed: 60, color: '#ffffff', background: '#0f172a', created_at: ts,
  });

  const screenNames = ['Front Counter Display', 'Aisle 3 Endcap', 'Window Display', 'Kiosk Entrance'];
  for (const [i, name] of screenNames.entries()) {
    await tx.insert(screens).values({
      id: uid('scr'), org_id: orgId, branch_id: branchIds[i % branchIds.length]!,
      name, playlist_id: alwaysOn, ticker_id: i === 0 ? tickerId : null,
      orientation: i === 2 ? 'portrait' : 'landscape',
      resolution: '1920x1080', os_type: 'web', status: 'offline', created_at: ts,
    });
  }

  // Two overlapping dayparts, so the conflict resolution has something to resolve.
  for (const [name, contentId, start, end] of [
    ['Breakfast Daypart', breakfast, '07:00', '11:00'],
    ['Lunch Daypart', lunch, '11:00', '15:00'],
  ] as const) {
    await tx.insert(schedules).values({
      id: uid('sch'), org_id: orgId, name, target_type: 'org', target_id: null,
      content_type: 'playlist', content_id: contentId,
      start_time: start, end_time: end, days_of_week: '[1,2,3,4,5]', created_at: ts,
    });
  }

  await tx.insert(subscriptions).values({
    id: uid('sub'), org_id: orgId, plan: 'growth', status: 'active', screen_count: 4,
    renews_at: new Date(Date.now() + 30 * 864e5).toISOString(),
    payment_method: 'manual:card', gateway: 'manual', created_at: ts,
  });
});

await closeDb();

console.log(`
Seeded Brandcast TV demo data.

  Dashboard : http://localhost:4000
  TV player : http://localhost:4000/tv

  Owner          owner@acme.test      / password123
  Admin          admin@acme.test      / password123
  Branch Manager manager@acme.test    / password123
  Content Editor editor@acme.test     / password123
  Viewer         viewer@acme.test     / password123
  Superadmin     superadmin@brandcast.tv / superadmin123
`);
