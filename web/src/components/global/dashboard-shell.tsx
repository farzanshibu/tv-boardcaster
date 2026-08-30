"use client";

// SOT: dashboard-shell, window-chrome, sidebar-source-list, toolbar, route-guard,
//      appearance-control, locale-switcher
// WHAT:  the authenticated chrome, built as a macOS window scene: traffic lights,
//        a translucent source list, a translucent toolbar, and the content pane.
// WHY:   DESIGN.md treats each route as a desktop window rather than a web page.
//        The shell also closes the block's gap: a page that renders without an API
//        call would otherwise bypass every permission rule (reference/the-block.md).
// HOW:   nav and the guard both read src/lib/resources.ts, so they cannot disagree.
//        Icons come from the typed registry, so a nav entry cannot reference a
//        glyph that does not exist.
// WHERE: registry in src/lib/resources.ts; session in src/lib/auth-context.tsx;
//        materials and tokens in src/app/globals.css

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button, Chip } from "@heroui/react";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n";
import { useAppearance, type Appearance } from "@/lib/appearance";
import { LOCALES, type Locale, type TranslationKey } from "@/lib/dictionaries";
import {
  navItems, permission, resourceForPath, inPlan, type NavGroup,
} from "@/lib/resources";
import { Icon, IconSlot, type IconName } from "@/components/global/icon";
import { SelectField } from "@/components/global/form";

const GROUP_LABEL: Record<NavGroup, TranslationKey> = {
  operate: "nav.operate",
  content: "nav.content",
  organization: "nav.org",
  platform: "nav.platform",
};

/* ---------------------------------------------------------------- chrome ---- */

/**
 * The three macOS window dots.
 * Decorative: they carry no action, but they are what makes a browser tab read as
 * an application window. Hidden from assistive tech.
 */
function TrafficLights() {
  return (
    <div aria-hidden="true" className="flex items-center gap-[6px] pe-1">
      <span className="size-[11px] rounded-full bg-[#ff5f57] ring-[0.5px] ring-black/12" />
      <span className="size-[11px] rounded-full bg-[#febc2e] ring-[0.5px] ring-black/12" />
      <span className="size-[11px] rounded-full bg-[#28c840] ring-[0.5px] ring-black/12" />
    </div>
  );
}

/**
 * macOS segmented control. Used for appearance because the options are few,
 * mutually exclusive, and worth showing at a glance. A dropdown would hide them.
 */
function AppearanceControl() {
  const { appearance, setAppearance } = useAppearance();
  const { t } = useI18n();

  const options: { id: Appearance; icon: IconName; label: string }[] = [
    { id: "system", icon: "appearanceSystem", label: t("appearance.system") },
    { id: "light", icon: "appearanceLight", label: t("appearance.light") },
    { id: "dark", icon: "appearanceDark", label: t("appearance.dark") },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={t("appearance.title")}
      className="flex items-center gap-0.5 rounded-control bg-surface-secondary p-0.5 ring-1 ring-border/70"
    >
      {options.map((o) => {
        const active = appearance === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.label}
            title={o.label}
            onClick={() => setAppearance(o.id)}
            className={`grid size-[24px] place-items-center rounded-[4px] transition-colors duration-150 ease-mac ${
              active
                ? "bg-surface text-foreground shadow-raised"
                : "text-muted hover:text-foreground"
            }`}
          >
            <Icon name={o.icon} size={14} />
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------- shell ---- */

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

  // Route change closes the mobile sidebar; leaving it open would cover the result.
  // Derived from pathname rather than an effect: no cascading render, and the
  // sidebar is never briefly open on the new route.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const sidebarOpen = openedAt === pathname;
  const toggleSidebar = () => setOpenedAt((prev) => (prev === pathname ? null : pathname));
  const closeSidebar = () => setOpenedAt(null);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2.5 text-muted">
        <Icon name="pending" size={16} className="animate-spin" />
        <span className="text-body">{t("common.loading")}</span>
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

  // Longest-prefix match, not `startsWith` per item: Overview lives at /dashboard,
  // so a naive prefix test would light it up on every child route as well.
  // resourceForPath already implements this and is what the route guard uses,
  // so the nav highlight and the guard can never disagree.
  const activeKey = resourceForPath(pathname);
  const activeItem = items.find((i) => i.key === activeKey);
  const windowTitle = activeItem ? t(activeItem.label as TranslationKey) : "Brandcast TV";

  return (
    <div className="flex min-h-screen bg-background">
      <a href="#main-content" className="skip-link">{t("action.skip")}</a>

      {/* Scrim for the sidebar below lg, where it becomes an overlay panel. */}
      {sidebarOpen ? (
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={closeSidebar}
          className="fixed inset-0 z-30 bg-backdrop lg:hidden"
        />
      ) : null}

      {/* ---- Source list ---- */}
      <nav
        aria-label="Main navigation"
        className={`material-sidebar fixed inset-y-0 z-40 flex w-[236px] shrink-0 flex-col border-e border-border transition-transform duration-200 ease-mac lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full rtl:translate-x-full"
        }`}
      >
        {/* Sidebar's own titlebar strip, so the traffic lights sit in the corner
            of the window rather than floating in the content pane. */}
        <div className="flex h-[52px] shrink-0 items-center gap-2.5 px-3.5">
          <TrafficLights />
          <span className="truncate text-footnote font-semibold tracking-[-0.01em] text-foreground">
            Brandcast TV
          </span>
        </div>

        <div className="flex-1 overflow-y-auto px-2.5 pb-2">
          {groups.map((group) => {
            const groupItems = items.filter((i) => i.group === group);
            if (!groupItems.length) return null;
            return (
              <div key={group} className="pb-1">
                <p className="px-2.5 pb-1 pt-3 text-caption2 font-semibold uppercase tracking-[0.06em] text-subtle">
                  {t(GROUP_LABEL[group])}
                </p>
                <ul className="flex flex-col gap-px">
                  {groupItems.map((item) => {
                    const active = item.key === activeKey;
                    return (
                      <li key={item.key}>
                        <Link
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          className={`flex h-[28px] items-center gap-2.5 rounded-control px-2.5 text-body transition-colors duration-150 ease-mac ${
                            active
                              ? "row-select font-medium"
                              : "text-foreground hover:bg-surface-hover"
                          }`}
                        >
                          <IconSlot
                            name={item.icon}
                            className={active ? "" : "text-muted"}
                          />
                          <span className="truncate">{t(item.label as TranslationKey)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>

        {/* Utility rows sit at the foot of the source list, as in Finder. */}
        <div className="flex flex-col gap-px border-t border-border/70 p-2.5">
          <Link
            href="/tv"
            target="_blank"
            className="flex h-[28px] items-center gap-2.5 rounded-control px-2.5 text-body text-foreground transition-colors duration-150 ease-mac hover:bg-surface-hover"
          >
            <IconSlot name="tv" className="text-muted" />
            <span className="truncate">{t("action.opentv")}</span>
            <Icon name="arrowUpRight" size={12} className="ms-auto text-subtle" />
          </Link>
          <button
            type="button"
            onClick={signOut}
            className="flex h-[28px] items-center gap-2.5 rounded-control px-2.5 text-start text-body text-foreground transition-colors duration-150 ease-mac hover:bg-surface-hover"
          >
            <IconSlot name="signOut" className="text-muted" />
            <span className="truncate">{t("action.signout")}</span>
          </button>
        </div>
      </nav>

      {/* ---- Window content ---- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="material-toolbar sticky top-0 z-20 flex h-[52px] items-center gap-3 border-b border-border px-4">
          <button
            type="button"
            aria-label="Toggle sidebar"
            onClick={toggleSidebar}
            className="grid size-[28px] shrink-0 place-items-center rounded-control text-muted transition-colors duration-150 ease-mac hover:bg-surface-hover hover:text-foreground lg:hidden"
          >
            <Icon name="sidebar" size={16} />
          </button>

          <div className="flex min-w-0 items-baseline gap-2.5">
            <h1 className="truncate text-title3 font-semibold tracking-[-0.01em] text-foreground">
              {windowTitle}
            </h1>
            <span className="hidden truncate text-footnote text-muted sm:inline">
              {session.org ? session.org.name : "Platform operations"}
            </span>
          </div>

          <div className="ms-auto flex shrink-0 items-center gap-2">
            {session.impersonating ? (
              <Chip color="warning" variant="soft" className="hidden sm:flex">
                <Icon name="security" size={12} />
                Support session
              </Chip>
            ) : null}
            {session.plan ? (
              <span className="hidden text-footnote text-muted xl:inline">
                {session.plan.name}
              </span>
            ) : null}
            <Chip variant="soft" className="hidden md:flex">{session.user.role}</Chip>
            <AppearanceControl />
            <SelectField
              ariaLabel={t("common.language")}
              selected={locale}
              onSelect={(id) => setLocale(id as Locale)}
              options={Object.entries(LOCALES).map(([id, label]) => ({ id, label }))}
              className="hidden w-[132px] md:block"
            />
          </div>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto min-w-0 w-full max-w-[1400px] flex-1 p-6"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

/** Shown when a plan does not include a resource. */
export function UpgradeNotice({ message }: { message: string }) {
  const router = useRouter();
  return (
    <div className="group-panel flex flex-col items-start gap-3 p-6">
      <span className="grid size-9 place-items-center rounded-full bg-accent-soft text-accent">
        <Icon name="billing" size={18} />
      </span>
      <p className="text-callout text-foreground">{message}</p>
      <Button variant="primary" size="sm" onPress={() => router.push("/dashboard/billing")}>
        View plans
      </Button>
    </div>
  );
}
