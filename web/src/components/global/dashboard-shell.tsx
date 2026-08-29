"use client";

// SOT: dashboard-shell, sidebar-nav, route-guard, locale-switcher
// WHAT:  the authenticated chrome: nav, topbar, and the permission guard.
// WHY:   closes the block's gap — a page that renders without an API call would
//        otherwise bypass every permission rule (see reference/the-block.md).
// HOW:   nav and the guard both read src/lib/resources.ts, so they cannot disagree.
// WHERE: registry in src/lib/resources.ts; session in src/lib/auth-context.tsx

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button, Chip, Spinner } from "@heroui/react";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n";
import { LOCALES, type Locale, type TranslationKey } from "@/lib/dictionaries";
import {
  navItems, permission, resourceForPath, inPlan, type NavGroup,
} from "@/lib/resources";
import { SelectField } from "@/components/global/form";

const GROUP_LABEL: Record<NavGroup, TranslationKey> = {
  operate: "nav.operate",
  content: "nav.content",
  organization: "nav.org",
  platform: "nav.platform",
};

const ICONS: Record<string, string> = {
  grid: "▦", monitor: "▶", clock: "◷", chart: "◔", image: "◈", list: "≣",
  megaphone: "⟿", building: "⌂", users: "👥", card: "₹", scroll: "⎙",
  gear: "⚙", star: "★",
};

export function DashboardShell({ children }: { children: ReactNode }) {
  const { session, loading, signOut, can } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const pathname = usePathname();
  const router = useRouter();

  const isSuper = session?.user.role === "superadmin";
  // A superadmin outside a support session has no tenant data; tenant routes would 403.
  const platformOnly = isSuper && !session?.org;

  useEffect(() => {
    if (loading) return;
    if (!session) { router.replace("/login"); return; }
    if (platformOnly && pathname !== "/dashboard/admin") {
      router.replace("/dashboard/admin");
      return;
    }
    // Guard pages that render without an API call.
    const resource = resourceForPath(pathname);
    if (resource && resource !== "platform" && !can(permission(resource, "read"))) {
      router.replace("/dashboard");
    }
  }, [loading, session, pathname, can, router, platformOnly]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-3 text-muted">
        <Spinner /> <span>{t("common.loading")}</span>
      </div>
    );
  }

  const items = navItems().filter((item) => {
    if (item.key === "platform") return isSuper;
    if (platformOnly) return false;
    if (!can(permission(item.key, "read"))) return false;
    // Hide resources the plan does not include at all.
    const plan = session.org?.plan_tier;
    return plan ? inPlan(item.key, plan) : true;
  });

  const groups: NavGroup[] = ["operate", "content", "organization", "platform"];

  return (
    <div className="flex min-h-screen">
      <a href="#main-content" className="skip-link">{t("action.skip")}</a>

      <nav
        aria-label="Main navigation"
        className="sticky top-0 flex h-screen w-60 shrink-0 flex-col gap-1 overflow-y-auto border-e border-border bg-surface p-3"
      >
        <p className="px-2 pb-4 pt-2 text-xs font-extrabold uppercase tracking-[0.22em] text-accent">
          Brandcast TV
        </p>

        {groups.map((group) => {
          const groupItems = items.filter((i) => i.group === group);
          if (!groupItems.length) return null;
          return (
            <div key={group}>
              <p className="px-3 pb-1 pt-3 text-[11px] uppercase tracking-wider text-muted">
                {t(GROUP_LABEL[group])}
              </p>
              {groupItems.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                      active
                        ? "bg-accent/15 font-semibold text-accent"
                        : "text-muted hover:bg-surface-secondary hover:text-foreground"
                    }`}
                  >
                    <span aria-hidden="true">{ICONS[item.icon] ?? "•"}</span>
                    {t(item.label as TranslationKey)}
                  </Link>
                );
              })}
            </div>
          );
        })}

        <div className="flex-1" />
        <Link
          href="/tv"
          target="_blank"
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface-secondary hover:text-foreground"
        >
          <span aria-hidden="true">⧉</span> {t("action.opentv")}
        </Link>
        <button
          type="button"
          onClick={signOut}
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-start text-sm text-muted hover:bg-surface-secondary hover:text-foreground"
        >
          <span aria-hidden="true">⏻</span> {t("action.signout")}
        </button>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-6 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">
              {session.org ? session.org.name : t("nav.platform")}
            </p>
            <p className="text-xs text-muted">
              {session.plan ? session.plan.name : "Platform operations"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {session.impersonating ? <Chip color="warning" variant="soft">Support session</Chip> : null}
            <Chip variant="soft">{session.user.role}</Chip>
            <SelectField
              ariaLabel={t("common.language")}
              selected={locale}
              onSelect={(id) => setLocale(id as Locale)}
              options={Object.entries(LOCALES).map(([id, label]) => ({ id, label }))}
              className="w-36"
            />
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

/** Shown when a plan does not include a resource. */
export function UpgradeNotice({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-accent/40 bg-accent/10 p-6">
      <p className="text-sm text-foreground">{message}</p>
      <Button variant="primary" size="sm" className="mt-3" onPress={() => { window.location.href = "/dashboard/billing"; }}>
        View plans
      </Button>
    </div>
  );
}
