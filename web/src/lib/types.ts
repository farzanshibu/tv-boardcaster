// SOT: domain-types, api-contract
// WHAT:  every shape the Brandcast API returns or accepts.
// WHY:   one declaration per concept so views cannot invent divergent shapes.
// HOW:   imported by the api client and every view; no view redeclares a model.
// WHERE: mirrors src/lib/db.js (server schema) and src/routes/*.js responses.

export type Role =
  | "owner"
  | "admin"
  | "branch_manager"
  | "content_editor"
  | "viewer"
  | "superadmin";

export type PlanKey = "trial" | "starter" | "growth" | "enterprise";

export interface Plan {
  name: string;
  price_per_screen: number;
  max_screens: number;
  max_users: number;
  features: string[];
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  org_id: string | null;
  branch_ids: string[];
  two_factor: boolean;
}

export interface Organization {
  id: string;
  name: string;
  plan_tier: PlanKey;
  country: string;
  status: "active" | "suspended";
  require_2fa: boolean;
  approval_required: boolean;
  feature_flags: Record<string, boolean>;
  gstin?: string | null;
}

export interface Session {
  user: User;
  org: Organization | null;
  plan: Plan | null;
  usage: { screens: number; users: number } | null;
  impersonating?: boolean;
}

export interface Branch {
  id: string;
  org_id: string;
  name: string;
  timezone: string;
  address: string | null;
  status: "active" | "archived";
  default_playlist_id: string | null;
  default_ticker_id: string | null;
  screen_count: number;
  created_at: string;
}

export type MediaType = "image" | "video" | "html";

/** Produced by the transcode pipeline; shapes differ for video vs image. */
export interface VideoRenditions {
  kind: "video";
  hls_url: string;
  poster_url: string;
  mp4: { height: number; bitrate_kbps: number; url: string }[];
  ladder: { height: number; bitrate_kbps: number }[];
  source: { width: number; height: number; duration: number };
}

export interface ImageRenditions {
  kind: "image";
  variants: { width: number; format: string; url: string; bytes: number }[];
  source: { width: number; height: number };
}

export type Renditions = VideoRenditions | ImageRenditions;

export type RenditionStatus = "none" | "queued" | "processing" | "ready" | "failed";

export interface MediaAsset {
  id: string;
  name: string;
  type: MediaType;
  url: string;
  bytes: number;
  duration: number;
  tags: string[];
  folder: string;
  version: number;
  status: "draft" | "pending" | "approved";
  storage_key: string | null;
  renditions: Renditions | null;
  rendition_status: RenditionStatus;
  rendition_error: string | null;
  created_at: string;
}

export interface MediaVersion {
  id: string;
  media_id: string;
  version: number;
  url: string;
  bytes: number;
  created_at: string;
}

export interface PlaylistItem {
  media_id: string;
  duration: number;
  media: Pick<MediaAsset, "id" | "name" | "type" | "url" | "duration" | "status">;
}

export interface Playlist {
  id: string;
  name: string;
  branch_id: string | null;
  items: PlaylistItem[];
  total_duration: number;
  status: "draft" | "pending" | "approved";
  updated_at: string;
}

export interface Ticker {
  id: string;
  name: string;
  text: string;
  position: "top" | "bottom";
  speed: number;
  color: string;
  background: string;
  branch_id: string | null;
  start_time: string | null;
  end_time: string | null;
}

export interface EffectiveContent {
  playlist_id: string | null;
  ticker_id: string | null;
  source: "schedule" | "static";
  conflicts: { id: string; name: string; target_type: string }[];
  schedule_id: string | null;
}

export interface Screen {
  id: string;
  name: string;
  branch_id: string;
  branch_name: string | null;
  playlist_id: string | null;
  playlist_name: string | null;
  ticker_id: string | null;
  ticker_name: string | null;
  orientation: "landscape" | "portrait";
  resolution: string | null;
  os_type: string | null;
  app_version: string | null;
  location_tag: string | null;
  status: "online" | "offline";
  connected: boolean;
  last_sync_at: string | null;
  last_seen_at: string | null;
  effective: EffectiveContent;
  created_at: string;
}

export interface Schedule {
  id: string;
  name: string;
  target_type: "screen" | "branch" | "org";
  target_id: string | null;
  content_type: "playlist" | "ticker";
  content_id: string;
  start_date: string | null;
  end_date: string | null;
  start_time: string;
  end_time: string;
  days_of_week: number[];
  priority: number;
  enabled: boolean;
  conflicts?: { id: string; name: string; target_type: string; resolution: string }[];
}

export interface Invoice {
  id: string;
  number: string;
  plan: string;
  screens: number;
  currency: string;
  subtotal: number;
  tax: number;
  tax_label: string;
  total: number;
  status: string;
  created_at: string;
}

export interface Subscription {
  id: string;
  plan: PlanKey;
  billing_cycle: "monthly" | "yearly";
  screen_count: number;
  status: "trialing" | "active" | "past_due" | "canceled";
  payment_method: string | null;
  renews_at: string | null;
}

export interface BillingSummary {
  subscription: Subscription;
  plan: Plan;
  plans: Record<PlanKey, Plan>;
  usage: { screens: number; users: number };
  near_limit: boolean;
  estimated_next_invoice: { currency: string; subtotal: number; tax: number };
  invoices: Invoice[];
}

export interface UptimeRow {
  screen_id: string;
  screen: string;
  branch: string | null;
  current_status: string;
  uptime_pct: number;
  online_hours: number;
  last_sync_at: string | null;
}

export interface UptimeReport {
  from: string;
  to: string;
  screens: UptimeRow[];
  by_branch: { branch: string | null; screens: number; uptime_pct: number }[];
  fleet_uptime_pct: number;
}

export interface ContentReport {
  by_media: { media_id: string; plays: number; seconds: number; media: { name: string; type: string } | null }[];
  by_playlist: { playlist_id: string; plays: number; seconds: number; playlist: { name: string } | null }[];
}

export interface Overview {
  total_screens: number;
  online_screens: number;
  offline_screens: number;
  branches: number;
  playlists: number;
  media: number;
  users: number;
  plan: Plan;
  usage: { screens: number; users: number };
  publishes_24h: number;
  recent_activity: { action: string; actor_email: string | null; target: string | null; created_at: string }[];
}

export interface AuditLog {
  id: string;
  action: string;
  actor_email: string | null;
  target: string | null;
  created_at: string;
  impersonated: number;
}

export interface AppNotification {
  id: string;
  kind: string;
  message: string;
  read: number;
  created_at: string;
}

export interface Tenant extends Organization {
  usage: { screens: number; users: number };
  plan: Plan;
  online_screens: number;
  revenue_mrr: number;
  subscription: Subscription | null;
}

export interface PlatformHealth {
  organizations: number;
  screens: number;
  online_screens: number;
  connected_sessions: number;
  publishes_24h: number;
  mrr: number;
  plan_distribution: { plan_tier: string; c: number }[];
  uptime_seconds: number;
  memory_mb: number;
  alerts: number;
}

export interface ScreenEvents {
  publishes: { id: string; status: string; source: string; created_at: string }[];
  status: { id: string; kind: string; detail: string | null; created_at: string }[];
  app_version: string | null;
  last_sync_at: string | null;
  last_seen_at: string | null;
}

export interface PairingCode {
  code: string;
  device_id: string;
  expires_at: string;
  expires_in_seconds: number;
}

/** Payload the TV client renders. */
export interface DevicePayload {
  screen: { id: string; name: string; orientation: string; branch: string | null; timezone: string };
  playlist: { id: string; name: string; items: { media_id: string; name: string; type: MediaType; url: string; duration: number }[] } | null;
  ticker: { id: string; text: string; position: "top" | "bottom"; speed: number; color: string; background: string } | null;
  source: string;
  conflicts: unknown[];
  generated_at: string;
}
