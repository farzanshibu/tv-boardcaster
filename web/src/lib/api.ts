// SOT: api-client, auth-token, error-messages
// WHAT:  the single typed gateway to the Brandcast REST API.
// WHY:   one place holds the token, the base URL and error normalisation.
// HOW:   every view calls api.<method>(); nothing else calls fetch directly.
// WHERE: server routes live in ../../src/routes/*.js

import type {
  Session, Branch, MediaAsset, MediaVersion, Playlist, Ticker, Screen, Schedule,
  BillingSummary, UptimeReport, ContentReport, Overview, AuditLog, AppNotification,
  Tenant, PlatformHealth, ScreenEvents, PairingCode, User, Role, PlanKey, Invoice,
} from "./types";

const TOKEN_KEY = "bc_token";

export const tokenStore = {
  get: (): string | null =>
    typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY),
  set: (t: string) => window.localStorage.setItem(TOKEN_KEY, t),
  clear: () => window.localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public data: Record<string, unknown>,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

const FRIENDLY: Record<string, string> = {
  screen_limit_reached: "Screen limit reached for your plan. Upgrade to add more screens.",
  user_limit_reached: "User limit reached for your plan. Upgrade to invite more users.",
  feature_not_in_plan: "This feature requires a higher plan.",
  screen_name_taken_in_branch: "A screen with that name already exists in this branch.",
  invalid_code: "That pairing code is not valid.",
  code_expired: "That pairing code has expired. Generate a new one on the TV.",
  playlist_assigned_to_screens: "This playlist is assigned to screens. Reassign them first.",
  media_in_use: "This media is used in a playlist and cannot be deleted.",
  forbidden: "Your role does not permit this action.",
  invalid_credentials: "That email or password is not correct.",
  totp_required: "Enter the code from your authenticator app.",
  invalid_totp: "That authenticator code is not valid.",
  too_many_requests: "Too many attempts. Please wait and try again.",
  downgrade_blocked_screen_count: "You have more screens than that plan allows.",
  email_taken: "An account with that email already exists.",
  organization_suspended: "This organization is suspended. Contact support.",
};

export const describeError = (e: unknown): string => {
  if (e instanceof ApiError) return FRIENDLY[e.code] ?? e.code.replace(/_/g, " ");
  if (e instanceof Error) return e.message;
  return "Something went wrong";
};

type Body = Record<string, unknown> | undefined;

async function call<T>(
  path: string,
  opts: { method?: string; body?: Body; form?: FormData } = {},
): Promise<T> {
  const headers = new Headers();
  const token = tokenStore.get();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (opts.body) headers.set("content-type", "application/json");

  const init: RequestInit = { method: opts.method ?? "GET", headers };
  const payload = opts.form ?? (opts.body ? JSON.stringify(opts.body) : null);
  if (payload !== null) init.body = payload;

  const res = await fetch(`/api${path}`, init);

  const data: Record<string, unknown> = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = data["error"];
    const code = typeof raw === "string" ? raw : `http_${res.status}`;
    throw new ApiError(res.status, code, data);
  }
  return data as T;
}

export const api = {
  // ---- auth ----
  login: (email: string, password: string, totp?: string) =>
    call<{ token: string; user: User }>("/auth/login", { method: "POST", body: { email, password, totp } }),
  signup: (b: { name: string; email: string; password: string; org_name: string; country: string }) =>
    call<{ token: string; user: User }>("/auth/signup", { method: "POST", body: b }),
  me: () => call<Session>("/auth/me"),
  acceptInvite: (token: string, name: string, password: string) =>
    call<{ token: string; user: User }>("/users/accept-invite", { method: "POST", body: { token, name, password } }),
  setup2fa: () => call<{ secret: string; otpauth: string }>("/auth/2fa/setup", { method: "POST" }),
  disable2fa: () => call<{ ok: boolean }>("/auth/2fa/disable", { method: "POST" }),
  updateOrg: (b: Body) => call<Record<string, unknown>>("/org", { method: "PATCH", body: b }),

  // ---- team ----
  users: () => call<User[]>("/users"),
  invite: (email: string, role: Role, branch_ids: string[]) =>
    call<{ invite_token: string }>("/users/invite", { method: "POST", body: { email, role, branch_ids } }),
  invites: () => call<{ id: string; email: string; role: string; token: string; created_at: string }[]>("/users/invites"),
  updateUser: (id: string, b: Body) => call<User>(`/users/${id}`, { method: "PATCH", body: b }),
  removeUser: (id: string) => call<{ ok: boolean }>(`/users/${id}`, { method: "DELETE" }),

  // ---- branches ----
  branches: () => call<Branch[]>("/branches"),
  createBranch: (b: Body) => call<Branch>("/branches", { method: "POST", body: b }),
  updateBranch: (id: string, b: Body) => call<Branch>(`/branches/${id}`, { method: "PATCH", body: b }),
  archiveBranch: (id: string) => call<{ ok: boolean }>(`/branches/${id}`, { method: "DELETE" }),

  // ---- media ----
  media: () => call<MediaAsset[]>("/media"),
  uploadMedia: (form: FormData) => call<MediaAsset>("/media", { method: "POST", form }),
  linkMedia: (b: Body) => call<MediaAsset>("/media/link", { method: "POST", body: b }),
  replaceMedia: (id: string, form: FormData) => call<MediaAsset>(`/media/${id}/replace`, { method: "POST", form }),
  mediaVersions: (id: string) => call<MediaVersion[]>(`/media/${id}/versions`),
  restoreMedia: (id: string, v: number) => call<MediaAsset>(`/media/${id}/restore/${v}`, { method: "POST" }),
  approveMedia: (id: string) => call<MediaAsset>(`/media/${id}/approve`, { method: "POST" }),
  deleteMedia: (id: string) => call<{ ok: boolean }>(`/media/${id}`, { method: "DELETE" }),

  // ---- playlists ----
  playlists: () => call<Playlist[]>("/playlists"),
  createPlaylist: (b: Body) => call<Playlist>("/playlists", { method: "POST", body: b }),
  updatePlaylist: (id: string, b: Body) => call<Playlist>(`/playlists/${id}`, { method: "PATCH", body: b }),
  approvePlaylist: (id: string) => call<Playlist>(`/playlists/${id}/approve`, { method: "POST" }),
  deletePlaylist: (id: string) => call<{ ok: boolean }>(`/playlists/${id}`, { method: "DELETE" }),

  // ---- tickers ----
  tickers: () => call<Ticker[]>("/tickers"),
  createTicker: (b: Body) => call<Ticker>("/tickers", { method: "POST", body: b }),
  updateTicker: (id: string, b: Body) => call<Ticker>(`/tickers/${id}`, { method: "PATCH", body: b }),
  deleteTicker: (id: string) => call<{ ok: boolean }>(`/tickers/${id}`, { method: "DELETE" }),

  // ---- screens & pairing ----
  screens: () => call<Screen[]>("/screens"),
  screen: (id: string) => call<Screen & { preview: unknown }>(`/screens/${id}`),
  createScreen: (b: Body) => call<Screen & { paired: boolean }>("/screens", { method: "POST", body: b }),
  updateScreen: (id: string, b: Body) => call<Screen>(`/screens/${id}`, { method: "PATCH", body: b }),
  unpairScreen: (id: string) => call<{ ok: boolean }>(`/screens/${id}/unpair`, { method: "POST" }),
  deleteScreen: (id: string) => call<{ ok: boolean }>(`/screens/${id}`, { method: "DELETE" }),
  publishScreen: (id: string) => call<{ publish_id: string; delivered: boolean }>(`/screens/${id}/publish`, { method: "POST" }),
  rollbackScreen: (id: string) => call<{ ok: boolean; delivered: boolean }>(`/screens/${id}/rollback`, { method: "POST" }),
  screenEvents: (id: string) => call<ScreenEvents>(`/screens/${id}/events`),
  bulkPublish: (b: Body) => call<{ targeted: number; delivered: number }>("/publish/bulk", { method: "POST", body: b }),
  verifyPairing: (code: string) =>
    call<{ valid: boolean; device_id: string; metadata: Record<string, unknown> }>("/pairing/verify", { method: "POST", body: { code } }),
  generateOtp: (device_id: string, metadata: Record<string, unknown>) =>
    call<PairingCode>("/pairing/generate-otp", { method: "POST", body: { device_id, metadata } }),

  // ---- schedules ----
  schedules: () => call<Schedule[]>("/schedules"),
  createSchedule: (b: Body) => call<Schedule>("/schedules", { method: "POST", body: b }),
  updateSchedule: (id: string, b: Body) => call<Schedule>(`/schedules/${id}`, { method: "PATCH", body: b }),
  deleteSchedule: (id: string) => call<{ ok: boolean }>(`/schedules/${id}`, { method: "DELETE" }),
  previewSchedule: (screenId: string) =>
    call<{ local: { time: string; dow: number }; timezone: string; active: { id: string; name: string; target_type: string; content_type: string }[]; resolved: { source: string } }>(
      `/schedules/preview/${screenId}`,
    ),

  // ---- insights ----
  overview: () => call<Overview>("/analytics/overview"),
  uptime: () => call<UptimeReport>("/analytics/uptime"),
  contentReport: () => call<ContentReport>("/analytics/content"),
  auditLogs: () => call<AuditLog[]>("/audit-logs"),
  notifications: () => call<AppNotification[]>("/notifications"),
  readNotifications: () => call<{ ok: boolean }>("/notifications/read", { method: "POST" }),

  // ---- billing ----
  billing: () => call<BillingSummary>("/billing"),
  subscribe: (plan: PlanKey, billing_cycle: string, gateway: string) =>
    call<{ ok: boolean; invoice: Invoice }>("/billing/subscribe", { method: "POST", body: { plan, billing_cycle, gateway } }),
  cancelSubscription: () => call<{ ok: boolean }>("/billing/cancel", { method: "POST" }),
  invoice: (id: string) =>
    call<Invoice & { bill_to: { organization: string; gstin: string | null }; issuer: { gstin: string }; line_items: { description: string; amount: number }[] }>(
      `/billing/invoices/${id}`,
    ),

  // ---- superadmin ----
  tenants: () => call<Tenant[]>("/admin/tenants"),
  platformHealth: () => call<PlatformHealth>("/admin/health"),
  setTenantPlan: (id: string, plan: PlanKey) => call<{ ok: boolean }>(`/admin/tenants/${id}/plan`, { method: "POST", body: { plan } }),
  suspendTenant: (id: string) => call<{ ok: boolean; status: string }>(`/admin/tenants/${id}/suspend`, { method: "POST" }),
  setTenantFlags: (id: string, flags: Record<string, boolean>) =>
    call<{ feature_flags: Record<string, boolean> }>(`/admin/tenants/${id}/flags`, { method: "POST", body: { flags } }),
  impersonate: (id: string, reason: string) =>
    call<{ token: string; org: { id: string; name: string } }>(`/admin/tenants/${id}/impersonate`, { method: "POST", body: { reason } }),
  runJobs: () => call<{ ok: boolean; republished: number }>("/admin/jobs/run", { method: "POST" }),
};
