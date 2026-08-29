import { Database } from 'bun:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');

const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'brandcast.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH, { create: true });
// bun:sqlite has no .pragma() helper; exec() is the equivalent.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

export function migrate() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    plan_tier TEXT NOT NULL DEFAULT 'trial',
    country TEXT DEFAULT 'IN',
    gstin TEXT,
    status TEXT NOT NULL DEFAULT 'active',       -- active | suspended
    require_2fa INTEGER NOT NULL DEFAULT 0,
    approval_required INTEGER NOT NULL DEFAULT 0,
    feature_flags TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    org_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,                           -- owner|admin|branch_manager|content_editor|viewer|superadmin
    branch_ids TEXT NOT NULL DEFAULT '[]',
    totp_secret TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invites (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    branch_ids TEXT NOT NULL DEFAULT '[]',
    token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    address TEXT,
    status TEXT NOT NULL DEFAULT 'active',        -- active | archived
    default_playlist_id TEXT,
    default_ticker_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,                           -- image|video|html
    url TEXT NOT NULL,
    bytes INTEGER NOT NULL DEFAULT 0,
    duration INTEGER NOT NULL DEFAULT 10,
    tags TEXT NOT NULL DEFAULT '[]',
    folder TEXT NOT NULL DEFAULT '/',
    version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'approved',      -- draft|pending|approved
    storage_key TEXT,                             -- object-storage key of the original
    renditions TEXT,                              -- JSON: HLS ladder / image variants
    rendition_status TEXT NOT NULL DEFAULT 'none',-- none|queued|processing|ready|failed
    rendition_error TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS media_versions (
    id TEXT PRIMARY KEY,
    media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    url TEXT NOT NULL,
    bytes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    items TEXT NOT NULL DEFAULT '[]',             -- [{media_id,duration}]
    status TEXT NOT NULL DEFAULT 'approved',      -- draft|pending|approved
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tickers (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    text TEXT NOT NULL,
    position TEXT NOT NULL DEFAULT 'bottom',
    speed INTEGER NOT NULL DEFAULT 60,
    color TEXT NOT NULL DEFAULT '#ffffff',
    background TEXT NOT NULL DEFAULT '#111827',
    start_time TEXT,                              -- 'HH:MM' local, optional
    end_time TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS screens (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    playlist_id TEXT REFERENCES playlists(id) ON DELETE SET NULL,
    ticker_id TEXT REFERENCES tickers(id) ON DELETE SET NULL,
    prev_playlist_id TEXT,
    orientation TEXT NOT NULL DEFAULT 'landscape',
    resolution TEXT,
    os_type TEXT,
    app_version TEXT,
    location_tag TEXT,
    device_token TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'offline',       -- online|offline
    last_sync_at TEXT,
    last_seen_at TEXT,
    offline_alert_sent INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pairings (
    code TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    screen_id TEXT,
    device_token TEXT,
    expires_at TEXT NOT NULL,
    claimed_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    target_type TEXT NOT NULL,                    -- screen|branch|org
    target_id TEXT,
    content_type TEXT NOT NULL DEFAULT 'playlist',-- playlist|ticker
    content_id TEXT NOT NULL,
    start_date TEXT,                              -- YYYY-MM-DD
    end_date TEXT,
    start_time TEXT NOT NULL DEFAULT '00:00',
    end_time TEXT NOT NULL DEFAULT '23:59',
    days_of_week TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
    priority INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS publish_events (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    screen_id TEXT NOT NULL,
    playlist_id TEXT,
    ticker_id TEXT,
    source TEXT NOT NULL DEFAULT 'manual',        -- manual|schedule|rollback
    status TEXT NOT NULL DEFAULT 'pending',       -- pending|delivered|rendered|failed
    actor_id TEXT,
    created_at TEXT NOT NULL,
    delivered_at TEXT,
    rendered_at TEXT
  );

  CREATE TABLE IF NOT EXISTS play_events (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    screen_id TEXT NOT NULL,
    media_id TEXT,
    playlist_id TEXT,
    duration INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS status_events (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    screen_id TEXT NOT NULL,
    kind TEXT NOT NULL,                           -- online|offline|sync|error
    detail TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    org_id TEXT,
    actor_id TEXT,
    actor_email TEXT,
    action TEXT NOT NULL,
    target TEXT,
    detail TEXT,
    impersonated INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
    plan TEXT NOT NULL DEFAULT 'trial',
    billing_cycle TEXT NOT NULL DEFAULT 'monthly',
    screen_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'trialing',      -- trialing|active|past_due|canceled
    payment_method TEXT,
    trial_ends_at TEXT,
    renews_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    number TEXT NOT NULL,
    plan TEXT NOT NULL,
    screens INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR',
    subtotal REAL NOT NULL,
    tax REAL NOT NULL DEFAULT 0,
    tax_label TEXT DEFAULT 'GST 18%',
    total REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'paid',
    period_start TEXT,
    period_end TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_screens_org ON screens(org_id);
  CREATE INDEX IF NOT EXISTS idx_screens_branch ON screens(branch_id);
  CREATE INDEX IF NOT EXISTS idx_pub_screen ON publish_events(screen_id);
  CREATE INDEX IF NOT EXISTS idx_status_screen ON status_events(screen_id);
  CREATE INDEX IF NOT EXISTS idx_play_org ON play_events(org_id);
  CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_logs(org_id);
  `);
  ensureColumns();
}

// Additive columns for databases created before object storage existed.
export function ensureColumns() {
  const cols = db.prepare('PRAGMA table_info(media)').all().map((c) => c.name);
  const add = (name, ddl) => { if (!cols.includes(name)) db.exec(`ALTER TABLE media ADD COLUMN ${ddl}`); };
  add('storage_key', 'storage_key TEXT');
  add('renditions', 'renditions TEXT');
  add('rendition_status', "rendition_status TEXT NOT NULL DEFAULT 'none'");
  add('rendition_error', 'rendition_error TEXT');
}

export const now = () => new Date().toISOString();
export const uid = (p = 'id') =>
  `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
