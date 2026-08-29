/* Seeds a realistic demo tenant + platform superadmin. */
import { db, migrate, uid, now } from '../src/lib/db.js';
import { hash } from '../src/lib/auth.js';

migrate();

const SVG = (bg, text, sub) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">
   <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
   <stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></linearGradient></defs>
   <rect width="1920" height="1080" fill="url(#g)"/>
   <text x="960" y="500" font-family="Helvetica" font-size="140" font-weight="bold" fill="#fff" text-anchor="middle">${text}</text>
   <text x="960" y="620" font-family="Helvetica" font-size="60" fill="#ffffffcc" text-anchor="middle">${sub}</text></svg>`);

const orgId = uid('org');
const ts = now();

db.transaction(() => {
  // platform superadmin (no tenant)
  if (!db.prepare("SELECT 1 FROM users WHERE role='superadmin'").get()) {
    db.prepare('INSERT INTO users (id,org_id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(uid('usr'), null, 'Platform Ops', 'superadmin@brandcast.tv', hash('superadmin123'), 'superadmin', ts);
  }

  db.prepare('INSERT INTO organizations (id,name,plan_tier,country,gstin,created_at) VALUES (?,?,?,?,?,?)')
    .run(orgId, 'Acme Retail India', 'growth', 'IN', '29AABCA1234C1ZX', ts);

  const users = [
    ['Arjun Mehta', 'owner@acme.test', 'owner'],
    ['Priya Nair', 'admin@acme.test', 'admin'],
    ['Riya Sharma', 'manager@acme.test', 'branch_manager'],
    ['Dev Kapoor', 'editor@acme.test', 'content_editor'],
    ['Neha Rao', 'viewer@acme.test', 'viewer'],
  ];

  const branches = [
    ['Koramangala Store', 'Asia/Kolkata'],
    ['Andheri West Store', 'Asia/Kolkata'],
    ['Dubai Mall Kiosk', 'Asia/Dubai'],
  ].map(([name, tz]) => {
    const id = uid('brn');
    db.prepare('INSERT INTO branches (id,org_id,name,timezone,created_at) VALUES (?,?,?,?,?)').run(id, orgId, name, tz, ts);
    return id;
  });

  const userIds = users.map(([name, email, role]) => {
    const id = uid('usr');
    db.prepare('INSERT INTO users (id,org_id,name,email,password_hash,role,branch_ids,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, orgId, name, email, hash('password123'), role, role === 'branch_manager' ? JSON.stringify([branches[0]]) : '[]', ts);
    return id;
  });

  const mediaSpec = [
    ['Diwali Mega Sale', ['#f97316', '#b91c1c'], 'DIWALI SALE', 'Up to 50% off'],
    ['Breakfast Combo', ['#0ea5e9', '#1e40af'], 'BREAKFAST', '₹99 combo till 11am'],
    ['Lunch Special', ['#16a34a', '#065f46'], 'LUNCH', 'Thali at ₹199'],
    ['New Arrivals', ['#8b5cf6', '#4c1d95'], 'NEW IN', 'Autumn collection'],
    ['Store Compliance Notice', ['#334155', '#0f172a'], 'NOTICE', 'CCTV in operation'],
  ];
  const mediaIds = mediaSpec.map(([name, bg, t, s]) => {
    const id = uid('med');
    db.prepare('INSERT INTO media (id,org_id,name,type,url,duration,tags,status,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id, orgId, name, 'image', SVG(bg, t, s), 8, JSON.stringify(['demo']), 'approved', userIds[0], ts);
    return id;
  });

  const mkPlaylist = (name, idx) => {
    const id = uid('pls');
    db.prepare('INSERT INTO playlists (id,org_id,name,items,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, orgId, name, JSON.stringify(idx.map((i) => ({ media_id: mediaIds[i], duration: 8 }))), 'approved', ts, ts);
    return id;
  };
  const plDefault = mkPlaylist('Always-On Brand Loop', [0, 3, 4]);
  const plBreakfast = mkPlaylist('Breakfast Daypart', [1, 4]);
  const plLunch = mkPlaylist('Lunch Daypart', [2, 0]);

  const tickerId = uid('tkr');
  db.prepare('INSERT INTO tickers (id,org_id,name,text,position,speed,color,background,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(tickerId, orgId, 'Store Hours & Offers', 'Welcome to Acme Retail  •  Store open 9am – 10pm  •  Members get 10% extra off today  •  Ask staff about our loyalty program', 'bottom', 60, '#ffffff', '#0f172a', ts);

  ['Front Counter Display', 'Aisle 3 Endcap', 'Window Display', 'Kiosk Entrance'].forEach((name, i) => {
    db.prepare(
      `INSERT INTO screens (id,org_id,branch_id,name,playlist_id,ticker_id,orientation,resolution,os_type,status,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(uid('scr'), orgId, branches[i % branches.length], name, plDefault, i === 0 ? tickerId : null,
          i === 2 ? 'portrait' : 'landscape', '1920x1080', 'web', 'offline', ts);
  });

  db.prepare('INSERT INTO schedules (id,org_id,name,target_type,target_id,content_type,content_id,start_time,end_time,days_of_week,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(uid('sch'), orgId, 'Breakfast Daypart', 'org', null, 'playlist', plBreakfast, '07:00', '11:00', '[1,2,3,4,5]', ts);
  db.prepare('INSERT INTO schedules (id,org_id,name,target_type,target_id,content_type,content_id,start_time,end_time,days_of_week,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(uid('sch'), orgId, 'Lunch Daypart', 'org', null, 'playlist', plLunch, '11:00', '15:00', '[1,2,3,4,5]', ts);

  db.prepare('INSERT INTO subscriptions (id,org_id,plan,status,screen_count,renews_at,payment_method,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(uid('sub'), orgId, 'growth', 'active', 4, new Date(Date.now() + 30 * 864e5).toISOString(), 'razorpay:card', ts);
})();

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
