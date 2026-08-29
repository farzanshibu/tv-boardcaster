// SOT: resources, permissions, plan-limits, navigation, upgrade-copy
// WHAT:  one entry per gated resource, driving permissions, limits and the sidebar.
// WHY:   a single registry means the nav, the gates and the plan caps cannot drift.
// HOW:   `as const satisfies` keeps literal types so PermissionKey stays a real union.
// WHERE: server-side equivalents live in ../../src/lib/plans.js and auth.js

import type { PlanKey, Role } from "./types";

export const UNLIMITED = -1;

type Limit = number;

interface ResourceDefinition {
  name: string;
  description: string;
  limits: Record<PlanKey, Limit>;
  permissions: readonly string[];
  upgradeMessage: string;
  nav?: { label: string; href: string; icon: string; group: NavGroup };
}

export type NavGroup = "operate" | "content" | "organization" | "platform";

const ALL: Record<PlanKey, Limit> = {
  trial: UNLIMITED, starter: UNLIMITED, growth: UNLIMITED, enterprise: UNLIMITED,
};

export const RESOURCES = {
  overview: {
    name: "Overview",
    description: "Fleet health and recent activity at a glance",
    limits: ALL,
    permissions: ["read"],
    upgradeMessage: "Upgrade to {next} for more.",
    nav: { label: "nav.overview", href: "/dashboard", icon: "grid", group: "operate" },
  },
  screens: {
    name: "Screens",
    description: "Paired displays showing your content",
    limits: { trial: 3, starter: 10, growth: 100, enterprise: UNLIMITED },
    permissions: ["create", "read", "update", "delete", "publish"],
    upgradeMessage: "You've reached your screen limit. Upgrade to {next} for more.",
    nav: { label: "nav.screens", href: "/dashboard/screens", icon: "monitor", group: "operate" },
  },
  schedules: {
    name: "Scheduling",
    description: "Dayparting and timed campaigns",
    limits: { trial: 0, starter: 0, growth: UNLIMITED, enterprise: UNLIMITED },
    permissions: ["create", "read", "update", "delete"],
    upgradeMessage: "Scheduling is available on {next}.",
    nav: { label: "nav.schedules", href: "/dashboard/schedules", icon: "clock", group: "operate" },
  },
  analytics: {
    name: "Analytics",
    description: "Uptime and content performance reporting",
    limits: { trial: 0, starter: 0, growth: UNLIMITED, enterprise: UNLIMITED },
    permissions: ["read"],
    upgradeMessage: "Analytics is available on {next}.",
    nav: { label: "nav.analytics", href: "/dashboard/analytics", icon: "chart", group: "operate" },
  },
  media: {
    name: "Media Library",
    description: "Images, video and HTML banners",
    limits: ALL,
    permissions: ["create", "read", "update", "delete", "approve"],
    upgradeMessage: "Upgrade to {next} for more media.",
    nav: { label: "nav.media", href: "/dashboard/media", icon: "image", group: "content" },
  },
  playlists: {
    name: "Playlists",
    description: "Ordered loops of media assets",
    limits: ALL,
    permissions: ["create", "read", "update", "delete", "approve"],
    upgradeMessage: "Upgrade to {next} for more playlists.",
    nav: { label: "nav.playlists", href: "/dashboard/playlists", icon: "list", group: "content" },
  },
  tickers: {
    name: "Flash News",
    description: "Scrolling ticker overlaid on playlists",
    limits: ALL,
    permissions: ["create", "read", "update", "delete"],
    upgradeMessage: "Upgrade to {next} for more tickers.",
    nav: { label: "nav.tickers", href: "/dashboard/tickers", icon: "megaphone", group: "content" },
  },
  branches: {
    name: "Branches",
    description: "Locations that group your screens",
    limits: ALL,
    permissions: ["create", "read", "update", "delete"],
    upgradeMessage: "Upgrade to {next} for more branches.",
    nav: { label: "nav.branches", href: "/dashboard/branches", icon: "building", group: "organization" },
  },
  team: {
    name: "Team & Roles",
    description: "Members and their permissions",
    limits: { trial: 3, starter: 5, growth: 25, enterprise: UNLIMITED },
    permissions: ["create", "read", "update", "delete"],
    upgradeMessage: "You've reached your user limit. Upgrade to {next} for more.",
    nav: { label: "nav.team", href: "/dashboard/team", icon: "users", group: "organization" },
  },
  billing: {
    name: "Billing",
    description: "Plan, usage and invoices",
    limits: ALL,
    permissions: ["read", "update"],
    upgradeMessage: "Upgrade to {next}.",
    nav: { label: "nav.billing", href: "/dashboard/billing", icon: "card", group: "organization" },
  },
  audit: {
    name: "Audit Log",
    description: "Every admin and publish action",
    limits: ALL,
    permissions: ["read"],
    upgradeMessage: "Upgrade to {next}.",
    nav: { label: "nav.audit", href: "/dashboard/audit", icon: "scroll", group: "organization" },
  },
  settings: {
    name: "Settings",
    description: "Organization and account preferences",
    limits: ALL,
    permissions: ["read", "update"],
    upgradeMessage: "Upgrade to {next}.",
    nav: { label: "nav.settings", href: "/dashboard/settings", icon: "gear", group: "organization" },
  },
  platform: {
    name: "Platform Admin",
    description: "Internal tenant and platform operations",
    limits: ALL,
    permissions: ["read", "update"],
    upgradeMessage: "Internal only.",
    nav: { label: "nav.admin", href: "/dashboard/admin", icon: "star", group: "platform" },
  },
} as const satisfies Record<string, ResourceDefinition>;

export type ResourceKey = keyof typeof RESOURCES;

/** Every permission that exists in the app, as a literal union. */
export type PermissionKey = {
  [R in ResourceKey]: `${R}:${(typeof RESOURCES)[R]["permissions"][number]}`;
}[ResourceKey];

/** Type-safe permission builder: a typo is a compile error. */
export const permission = <R extends ResourceKey, P extends (typeof RESOURCES)[R]["permissions"][number]>(
  resource: R,
  action: P,
): `${R}:${P}` => `${resource}:${action}`;

/* ---------------- role capabilities ---------------- */

const CAPABILITIES: Record<Role, readonly PermissionKey[] | "*"> = {
  viewer: [
    "overview:read", "screens:read", "media:read", "playlists:read", "tickers:read",
    "branches:read", "schedules:read", "analytics:read", "team:read", "settings:read",
  ],
  content_editor: [
    "overview:read", "screens:read", "media:read", "media:create", "media:update", "media:delete",
    "playlists:read", "playlists:create", "playlists:update", "playlists:delete",
    "tickers:read", "tickers:create", "tickers:update", "tickers:delete",
    "branches:read", "schedules:read", "analytics:read", "team:read", "settings:read",
  ],
  branch_manager: [
    "overview:read", "screens:read", "screens:create", "screens:update", "screens:delete", "screens:publish",
    "media:read", "media:create", "media:update", "media:delete",
    "playlists:read", "playlists:create", "playlists:update", "playlists:delete",
    "tickers:read", "tickers:create", "tickers:update", "tickers:delete",
    "branches:read", "schedules:read", "schedules:create", "schedules:update", "schedules:delete",
    "analytics:read", "team:read", "settings:read",
  ],
  admin: [
    "overview:read", "screens:read", "screens:create", "screens:update", "screens:delete", "screens:publish",
    "media:read", "media:create", "media:update", "media:delete", "media:approve",
    "playlists:read", "playlists:create", "playlists:update", "playlists:delete", "playlists:approve",
    "tickers:read", "tickers:create", "tickers:update", "tickers:delete",
    "branches:read", "branches:create", "branches:update", "branches:delete",
    "schedules:read", "schedules:create", "schedules:update", "schedules:delete",
    "analytics:read", "team:read", "team:create", "team:update", "team:delete",
    "audit:read", "settings:read", "settings:update",
  ],
  owner: "*",
  superadmin: "*",
};

export function can(role: Role | undefined, perm: PermissionKey): boolean {
  if (!role) return false;
  const caps = CAPABILITIES[role];
  if (caps === "*") return true;
  return caps.includes(perm);
}

/* ---------------- plans ---------------- */

export const PLAN_ORDER: PlanKey[] = ["trial", "starter", "growth", "enterprise"];

export const nextPlan = (current: PlanKey): string => {
  const i = PLAN_ORDER.indexOf(current);
  const next = i < 0 ? undefined : PLAN_ORDER[i + 1];
  return next === undefined ? "a higher plan" : RESOURCE_PLAN_LABEL[next];
};

const RESOURCE_PLAN_LABEL: Record<PlanKey, string> = {
  trial: "Free Trial", starter: "Starter", growth: "Growth", enterprise: "Enterprise",
};

export function upgradeMessage(resource: ResourceKey, current: PlanKey): string {
  return RESOURCES[resource].upgradeMessage.replace("{next}", nextPlan(current));
}

/** Is this resource available at all on the given plan? */
export function inPlan(resource: ResourceKey, plan: PlanKey): boolean {
  return RESOURCES[resource].limits[plan] !== 0;
}

/* ---------------- navigation ---------------- */

export interface NavItem {
  key: ResourceKey;
  label: string;
  href: string;
  icon: string;
  group: NavGroup;
}

export function navItems(): NavItem[] {
  const out: NavItem[] = [];
  for (const key of Object.keys(RESOURCES) as ResourceKey[]) {
    const def = RESOURCES[key];
    // Entries without `nav` are narrowed to not have the property at all.
    if (!("nav" in def)) continue;
    out.push({ key, ...def.nav });
  }
  return out;
}

/** Longest-prefix match so /dashboard/billing/invoices resolves to billing. */
export function resourceForPath(pathname: string): ResourceKey | null {
  let best: { key: ResourceKey; len: number } | null = null;
  for (const item of navItems()) {
    if (pathname === item.href || pathname.startsWith(item.href + "/")) {
      if (!best || item.href.length > best.len) best = { key: item.key, len: item.href.length };
    }
  }
  return best?.key ?? null;
}
