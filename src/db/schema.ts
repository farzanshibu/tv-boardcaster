// SOT: database-schema, tables, columns, row-types
// WHAT:  every table in Brandcast TV, in one Drizzle schema.
// WHY:   one file is the whole data model, and `drizzle-kit generate` derives the
//        migration SQL from it, so the schema cannot drift from the database.
// HOW:   ids are application-generated strings (`uid('scr')`) rather than serials, so
//        a row can be created and referenced without a round trip. Timestamps are
//        stored as ISO-8601 text: they sort lexicographically, which is what the
//        range queries rely on, and they reach the API and the TV client unchanged.
//        Flags are 0/1 integers rather than booleans because the JSON they produce is
//        part of the published API (`notification.read === 1`). Property names match
//        the column names for the same reason: rows are serialised straight to the
//        response, and the dashboard's types are written in snake_case.
// WHERE: connection and migrations in src/db/client.ts

import { relations } from 'drizzle-orm';
import {
  doublePrecision, index, integer, pgTable, text, unique,
} from 'drizzle-orm/pg-core';

/** ISO-8601 UTC string, e.g. 2026-08-30T06:40:41.480Z */
const timestamp = (name: string) => text(name);
/** 0 or 1. Not `boolean`: the integer is what clients already receive. */
const flag = (name: string) => integer(name);

/* ------------------------------------------------------------------ *
 * Tenancy
 * ------------------------------------------------------------------ */

export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  plan_tier: text('plan_tier').notNull().default('trial'),
  country: text('country').default('IN'),
  gstin: text('gstin'),
  /** active | suspended */
  status: text('status').notNull().default('active'),
  require_2fa: flag('require_2fa').notNull().default(0),
  approval_required: flag('approval_required').notNull().default(0),
  /** JSON object overriding the plan's feature list, per tenant. */
  feature_flags: text('feature_flags').notNull().default('{}'),
  created_at: timestamp('created_at').notNull(),
});

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  /** Null for platform superadmins, who belong to no tenant. */
  org_id: text('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  password_hash: text('password_hash').notNull(),
  /** owner | admin | branch_manager | content_editor | viewer | superadmin */
  role: text('role').notNull(),
  /** JSON array; only meaningful for branch_manager. */
  branch_ids: text('branch_ids').notNull().default('[]'),
  totp_secret: text('totp_secret'),
  status: text('status').notNull().default('active'),
  created_at: timestamp('created_at').notNull(),
}, (t) => [index('idx_users_org').on(t.org_id)]);

export const invites = pgTable('invites', {
  id: text('id').primaryKey(),
  org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role').notNull(),
  branch_ids: text('branch_ids').notNull().default('[]'),
  token: text('token').notNull().unique(),
  /** pending | accepted */
  status: text('status').notNull().default('pending'),
  created_at: timestamp('created_at').notNull(),
}, (t) => [index('idx_invites_org').on(t.org_id)]);

export const branches = pgTable('branches', {
  id: text('id').primaryKey(),
  org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** IANA zone; dayparting is resolved in the branch's local time. */
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  address: text('address'),
  /** active | archived */
  status: text('status').notNull().default('active'),
  default_playlist_id: text('default_playlist_id'),
  default_ticker_id: text('default_ticker_id'),
  created_at: timestamp('created_at').notNull(),
}, (t) => [index('idx_branches_org').on(t.org_id)]);

/* ------------------------------------------------------------------ *
 * Content
 * ------------------------------------------------------------------ */

export const media = pgTable('media', {
  id: text('id').primaryKey(),
  org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** image | video | html */
  type: text('type').notNull(),
  url: text('url').notNull(),
  bytes: integer('bytes').notNull().default(0),
  /** Seconds on screen; a playlist item may override it. */
  duration: integer('duration').notNull().default(10),
  tags: text('tags').notNull().default('[]'),
  folder: text('folder').notNull().default('/'),
  version: integer('version').notNull().default(1),
  /** draft | pending | approved */
  status: text('status').notNull().default('approved'),
  /** Object-storage key of the original upload. */
  storage_key: text('storage_key'),
  /** JSON manifest: HLS ladder, MP4 fallbacks, image variants. */
  renditions: text('renditions'),
  /** none | queued | processing | ready | failed */
  rendition_status: text('rendition_status').notNull().default('none'),
  rendition_error: text('rendition_error'),
  created_by: text('created_by'),
  created_at: timestamp('created_at').notNull(),
}, (t) => [index('idx_media_org').on(t.org_id)]);

export const mediaVersions = pgTable('media_versions', {
  id: text('id').primaryKey(),
  media_id: text('media_id').notNull().references(() => media.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  url: text('url').notNull(),
  bytes: integer('bytes').notNull().default(0),
  created_at: timestamp('created_at').notNull(),
}, (t) => [index('idx_media_versions_media').on(t.media_id)]);

export const playlists = pgTable('playlists', {
  id: text('id').primaryKey(),
  org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  branch_id: text('branch_id').references(() => branches.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  /** JSON: [{ media_id, duration }] — order is the play order. */
  items: text('items').notNull().default('[]'),
  /** draft | pending | approved. Only approved playlists reach a screen. */
  status: text('status').notNull().default('approved'),
  created_at: timestamp('created_at').notNull(),
  updated_at: timestamp('updated_at').notNull(),
}, (t) => [index('idx_playlists_org').on(t.org_id)]);

export const tickers = pgTable('tickers', {
  id: text('id').primaryKey(),
  org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  branch_id: text('branch_id').references(() => branches.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  text: text('text').notNull(),
  /** top | bottom */
  position: text('position').notNull().default('bottom'),
  speed: integer('speed').notNull().default(60),
  color: text('color').notNull().default('#ffffff'),
  background: text('background').notNull().default('#111827'),
  /** 'HH:MM' in the branch's local time; both null means always on. */
  start_time: text('start_time'),
  end_time: text('end_time'),
  created_at: timestamp('created_at').notNull(),
}, (t) => [index('idx_tickers_org').on(t.org_id)]);

/* ------------------------------------------------------------------ *
 * Screens and pairing
 * ------------------------------------------------------------------ */

export const screens = pgTable('screens', {
  id: text('id').primaryKey(),
  org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  branch_id: text('branch_id').notNull().references(() => branches.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  playlist_id: text('playlist_id').references(() => playlists.id, { onDelete: 'set null' }),
  ticker_id: text('ticker_id').references(() => tickers.id, { onDelete: 'set null' }),
  /** What a rollback returns to. */
  prev_playlist_id: text('prev_playlist_id'),
  orientation: text('orientation').notNull().default('landscape'),
  resolution: text('resolution'),
  os_type: text('os_type'),
  app_version: text('app_version'),
  location_tag: text('location_tag'),
  /** The device's JWT. Nulling it is what unpairing means. */
  device_token: text('device_token').unique(),
  /** online | offline */
  status: text('status').notNull().default('offline'),
  last_sync_at: timestamp('last_sync_at'),
  last_seen_at: timestamp('last_seen_at'),
  offline_alert_sent: flag('offline_alert_sent').notNull().default(0),
  created_at: timestamp('created_at').notNull(),
}, (t) => [
  index('idx_screens_org').on(t.org_id),
  index('idx_screens_branch').on(t.branch_id),
]);

export const pairings = pgTable('pairings', {
  /** The 4-digit code the TV displays. */
  code: text('code').primaryKey(),
  device_id: text('device_id').notNull(),
  metadata: text('metadata').notNull().default('{}'),
  screen_id: text('screen_id'),
  device_token: text('device_token'),
  expires_at: timestamp('expires_at').notNull(),
  claimed_at: timestamp('claimed_at'),
  created_at: timestamp('created_at').notNull(),
}, (t) => [index('idx_pairings_device').on(t.device_id)]);

export const schedules = pgTable('schedules', {
  id: text('id').primaryKey(),
  org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** screen | branch | org — narrower scope wins over a broader one. */
  target_type: text('target_type').notNull(),
  target_id: text('target_id'),
  /** playlist | ticker */
  content_type: text('content_type').notNull().default('playlist'),
  content_id: text('content_id').notNull(),
  /** YYYY-MM-DD, optional bounds on the whole schedule. */
  start_date: text('start_date'),
  end_date: text('end_date'),
  /** 'HH:MM'; start > end means the window runs past midnight. */
  start_time: text('start_time').notNull().default('00:00'),
  end_time: text('end_time').notNull().default('23:59'),
  /** JSON array of 0..6, Sunday first. */
  days_of_week: text('days_of_week').notNull().default('[0,1,2,3,4,5,6]'),
  /** Tie-breaker between schedules of equal scope. */
  priority: integer('priority').notNull().default(0),
  enabled: flag('enabled').notNull().default(1),
  created_at: timestamp('created_at').notNull(),
}, (t) => [index('idx_schedules_org').on(t.org_id)]);

/* ------------------------------------------------------------------ *
 * Telemetry
 * ------------------------------------------------------------------ */

export const publishEvents = pgTable('publish_events', {
  id: text('id').primaryKey(),
  org_id: text('org_id').notNull(),
  screen_id: text('screen_id').notNull(),
  playlist_id: text('playlist_id'),
  ticker_id: text('ticker_id'),
  /** manual | schedule | rollback */
  source: text('source').notNull().default('manual'),
  /** pending -> delivered (hub accepted) -> rendered (device acked) */
  status: text('status').notNull().default('pending'),
  actor_id: text('actor_id'),
  created_at: timestamp('created_at').notNull(),
  delivered_at: timestamp('delivered_at'),
  rendered_at: timestamp('rendered_at'),
}, (t) => [
  index('idx_pub_screen').on(t.screen_id),
  index('idx_pub_org_created').on(t.org_id, t.created_at),
]);

export const playEvents = pgTable('play_events', {
  id: text('id').primaryKey(),
  org_id: text('org_id').notNull(),
  screen_id: text('screen_id').notNull(),
  media_id: text('media_id'),
  playlist_id: text('playlist_id'),
  /** Seconds actually played, as reported by the device. */
  duration: integer('duration').notNull().default(0),
  created_at: timestamp('created_at').notNull(),
}, (t) => [index('idx_play_org_created').on(t.org_id, t.created_at)]);

export const statusEvents = pgTable('status_events', {
  id: text('id').primaryKey(),
  org_id: text('org_id').notNull(),
  screen_id: text('screen_id').notNull(),
  /** online | offline | sync | error — uptime is derived from these transitions. */
  kind: text('kind').notNull(),
  detail: text('detail'),
  created_at: timestamp('created_at').notNull(),
}, (t) => [index('idx_status_screen_created').on(t.screen_id, t.created_at)]);

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  org_id: text('org_id').notNull(),
  kind: text('kind').notNull(),
  message: text('message').notNull(),
  read: flag('read').notNull().default(0),
  created_at: timestamp('created_at').notNull(),
}, (t) => [index('idx_notifications_org').on(t.org_id, t.created_at)]);

export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  org_id: text('org_id'),
  actor_id: text('actor_id'),
  actor_email: text('actor_email'),
  action: text('action').notNull(),
  target: text('target'),
  /** JSON blob of the request that caused it. */
  detail: text('detail'),
  /** 1 when a superadmin was acting inside the tenant. */
  impersonated: flag('impersonated').notNull().default(0),
  created_at: timestamp('created_at').notNull(),
}, (t) => [index('idx_audit_org_created').on(t.org_id, t.created_at)]);

/* ------------------------------------------------------------------ *
 * Billing
 * ------------------------------------------------------------------ */

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey(),
  org_id: text('org_id').notNull().unique().references(() => organizations.id, { onDelete: 'cascade' }),
  plan: text('plan').notNull().default('trial'),
  /** monthly | yearly */
  billing_cycle: text('billing_cycle').notNull().default('monthly'),
  screen_count: integer('screen_count').notNull().default(0),
  /** trialing | active | past_due | canceled */
  status: text('status').notNull().default('trialing'),
  /** Free text record of how it was settled. Never card data. */
  payment_method: text('payment_method'),
  trial_ends_at: timestamp('trial_ends_at'),
  renews_at: timestamp('renews_at'),
  /** manual | stripe | razorpay */
  gateway: text('gateway'),
  gateway_customer_id: text('gateway_customer_id'),
  gateway_subscription_id: text('gateway_subscription_id'),
  cancel_at_period_end: flag('cancel_at_period_end').notNull().default(0),
  created_at: timestamp('created_at').notNull(),
}, (t) => [index('idx_subs_gateway_sub').on(t.gateway_subscription_id)]);

export const invoices = pgTable('invoices', {
  id: text('id').primaryKey(),
  org_id: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  /** Human-facing document number, e.g. BC-2026-A1B2C3. */
  number: text('number').notNull(),
  plan: text('plan').notNull(),
  screens: integer('screens').notNull(),
  currency: text('currency').notNull().default('INR'),
  subtotal: doublePrecision('subtotal').notNull(),
  tax: doublePrecision('tax').notNull().default(0),
  tax_label: text('tax_label').default('GST 18%'),
  total: doublePrecision('total').notNull(),
  status: text('status').notNull().default('paid'),
  period_start: timestamp('period_start'),
  period_end: timestamp('period_end'),
  gateway: text('gateway'),
  gateway_invoice_id: text('gateway_invoice_id'),
  created_at: timestamp('created_at').notNull(),
}, (t) => [index('idx_invoices_org_created').on(t.org_id, t.created_at)]);

/* ------------------------------------------------------------------ *
 * Work queues
 * ------------------------------------------------------------------ */

/**
 * Durable transcode queue. Rows outlive a restart and any node may claim one,
 * which is what turns the in-process loop into a worker pool.
 */
export const transcodeJobs = pgTable('transcode_jobs', {
  id: text('id').primaryKey(),
  org_id: text('org_id').notNull(),
  media_id: text('media_id').notNull(),
  /** video | image */
  kind: text('kind').notNull(),
  name: text('name').notNull().default(''),
  /** The uploading node's temp file. Gone once that node cleans up. */
  source_path: text('source_path'),
  /** Object-storage key: the source every worker can reach. */
  source_key: text('source_key'),
  cleanup: flag('cleanup').notNull().default(0),
  /** queued | processing | done | failed */
  status: text('status').notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  max_attempts: integer('max_attempts').notNull().default(3),
  error: text('error'),
  locked_by: text('locked_by'),
  locked_at: timestamp('locked_at'),
  /** Not runnable before this instant — the retry backoff. */
  available_at: timestamp('available_at').notNull(),
  created_at: timestamp('created_at').notNull(),
  updated_at: timestamp('updated_at').notNull(),
}, (t) => [
  index('idx_tjobs_claim').on(t.status, t.available_at),
  index('idx_tjobs_media').on(t.media_id),
]);

/** Gateway webhooks are at-least-once; the unique key makes a replay a no-op. */
export const webhookEvents = pgTable('webhook_events', {
  id: text('id').primaryKey(),
  gateway: text('gateway').notNull(),
  /** The gateway's own event id. */
  event_id: text('event_id').notNull(),
  type: text('type').notNull(),
  org_id: text('org_id'),
  status: text('status').notNull().default('processed'),
  payload: text('payload'),
  created_at: timestamp('created_at').notNull(),
}, (t) => [unique('uq_webhook_event').on(t.gateway, t.event_id)]);

/* ------------------------------------------------------------------ *
 * Relations — declared for the org-scoped graph the dashboard reads.
 * ------------------------------------------------------------------ */

export const organizationsRelations = relations(organizations, ({ many, one }) => ({
  users: many(users),
  branches: many(branches),
  screens: many(screens),
  media: many(media),
  playlists: many(playlists),
  tickers: many(tickers),
  schedules: many(schedules),
  invoices: many(invoices),
  subscription: one(subscriptions),
}));

export const branchesRelations = relations(branches, ({ one, many }) => ({
  organization: one(organizations, { fields: [branches.org_id], references: [organizations.id] }),
  screens: many(screens),
}));

export const screensRelations = relations(screens, ({ one }) => ({
  organization: one(organizations, { fields: [screens.org_id], references: [organizations.id] }),
  branch: one(branches, { fields: [screens.branch_id], references: [branches.id] }),
  playlist: one(playlists, { fields: [screens.playlist_id], references: [playlists.id] }),
  ticker: one(tickers, { fields: [screens.ticker_id], references: [tickers.id] }),
}));

export const playlistsRelations = relations(playlists, ({ one }) => ({
  organization: one(organizations, { fields: [playlists.org_id], references: [organizations.id] }),
  branch: one(branches, { fields: [playlists.branch_id], references: [branches.id] }),
}));

export const mediaRelations = relations(media, ({ one, many }) => ({
  organization: one(organizations, { fields: [media.org_id], references: [organizations.id] }),
  versions: many(mediaVersions),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  organization: one(organizations, { fields: [subscriptions.org_id], references: [organizations.id] }),
}));

/* ------------------------------------------------------------------ *
 * Row types
 * ------------------------------------------------------------------ */

export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type Branch = typeof branches.$inferSelect;
export type Media = typeof media.$inferSelect;
export type MediaVersion = typeof mediaVersions.$inferSelect;
export type Playlist = typeof playlists.$inferSelect;
export type Ticker = typeof tickers.$inferSelect;
export type Screen = typeof screens.$inferSelect;
export type Pairing = typeof pairings.$inferSelect;
export type Schedule = typeof schedules.$inferSelect;
export type PublishEvent = typeof publishEvents.$inferSelect;
export type PlayEvent = typeof playEvents.$inferSelect;
export type StatusEvent = typeof statusEvents.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type TranscodeJob = typeof transcodeJobs.$inferSelect;
export type WebhookEvent = typeof webhookEvents.$inferSelect;

export type NewOrganization = typeof organizations.$inferInsert;
export type NewUser = typeof users.$inferInsert;
export type NewScreen = typeof screens.$inferInsert;
export type NewMedia = typeof media.$inferInsert;
export type NewPlaylist = typeof playlists.$inferInsert;
export type NewTranscodeJob = typeof transcodeJobs.$inferInsert;
