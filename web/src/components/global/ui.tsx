"use client";

// SOT: global-ui-primitives, page-chrome, status-indicators, grouped-inset-list
// WHAT:  shared building blocks for every dashboard view, in the macOS idiom:
//        grouped inset sections, source-list rows, status pills, skeletons.
// WHY:   copying a Card+Table shell into 13 views is how designs drift apart, and
//        DESIGN.md bans the identical-card-grid pattern the old primitives encouraged.
// HOW:   thin compositions over HeroUI and the token layer. No hardcoded colours,
//        no emoji, every icon from the typed registry.
// WHERE: tokens in src/app/globals.css; icons in src/components/global/icon.tsx

import { Alert, Button } from "@heroui/react";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/global/icon";

/* ------------------------------------------------------------------ page ---- */

/**
 * The view's toolbar-adjacent action row.
 *
 * The window toolbar already displays the route name, so repeating it here would
 * print the same word twice, 20px apart. Instead this row carries the *state*
 * (how many, how healthy) on the leading edge and the actions on the trailing
 * edge, which is how a Finder or Mail window is laid out.
 *
 * `title` is still accepted and is rendered for assistive tech only, so each view
 * keeps a real <h2> in the document outline.
 */
export function PageHeader({
  title, subtitle, actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h2 className="sr-only">{title}</h2>
      {subtitle ? (
        <p className="text-callout text-muted">{subtitle}</p>
      ) : (
        <span />
      )}
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- panels ---- */

/**
 * Grouped inset section: the workhorse container (System Settings, insetGrouped).
 * Deliberately not called "Card": it is a section of the window, not a floating tile,
 * and it never nests.
 */
export function SectionCard({
  title, description, actions, children, className, flush,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Drop body padding when the child manages its own edges (tables, lists). */
  flush?: boolean;
}) {
  return (
    <section className={`group-panel ${className ?? ""}`}>
      {title || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-separator px-4 py-2.5">
          <div className="min-w-0">
            {title ? (
              <h3 className="text-headline font-semibold tracking-[-0.01em] text-foreground">
                {title}
              </h3>
            ) : null}
            {description ? <p className="text-footnote text-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------ statistics ---- */

/**
 * A single metric in a grouped strip.
 * Not the hero-metric template: the number is title2, not display size, and the
 * icon is a quiet monochrome mark rather than a coloured badge. Colour appears
 * only when the value itself is a warning.
 */
export function StatCard({
  label, value, hint, icon, tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: IconName;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const toneClass =
    tone === "success" ? "text-success" :
    tone === "warning" ? "text-warning" :
    tone === "danger" ? "text-danger" : "text-foreground";
  return (
    <div className="group-panel p-4">
      <div className="flex items-center gap-1.5 text-muted">
        {icon ? <Icon name={icon} size={13} /> : null}
        <p className="truncate text-footnote">{label}</p>
      </div>
      <p className={`mt-1.5 text-title2 font-semibold tabular-nums tracking-[-0.02em] ${toneClass}`}>
        {value}
      </p>
      {hint ? <p className="mt-0.5 truncate text-footnote text-muted">{hint}</p> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- status ---- */

/**
 * Status pill. Icon plus text, never colour alone (PRODUCT.md accessibility).
 */
export function StatusPill({
  tone, children, icon,
}: {
  tone: "success" | "warning" | "danger" | "accent" | "neutral";
  children: ReactNode;
  icon?: IconName;
}) {
  const toneClass = {
    success: "bg-success-soft text-success-soft-foreground",
    warning: "bg-warning-soft text-warning-soft-foreground",
    danger: "bg-danger-soft text-danger-soft-foreground",
    accent: "bg-accent-soft text-accent-soft-foreground",
    neutral: "bg-surface-secondary text-muted",
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-chip px-2 py-[3px] text-caption font-medium ${toneClass}`}
    >
      {icon ? <Icon name={icon} size={11} /> : null}
      {children}
    </span>
  );
}

export function StatusChip({ online, label }: { online: boolean; label?: string }) {
  return (
    <StatusPill tone={online ? "success" : "danger"} icon={online ? "online" : "offline"}>
      {label ?? (online ? "Online" : "Offline")}
    </StatusPill>
  );
}

/** Small filled dot for dense rows where a full pill would crowd the line. */
export function StatusDot({ online, label }: { online: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={`size-[7px] shrink-0 rounded-full ${online ? "bg-success" : "bg-danger"}`}
      />
      <span className="sr-only">{online ? "Online" : "Offline"}: </span>
      {label}
    </span>
  );
}

/* -------------------------------------------------------------- feedback ---- */

/** Empty states teach the next action and offer the control that performs it. */
export function EmptyState({
  title, hint, action, icon = "info",
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="mb-1 grid size-11 place-items-center rounded-full bg-surface-secondary text-subtle">
        <Icon name={icon} size={20} />
      </span>
      <p className="text-callout font-medium text-foreground">{title}</p>
      {hint ? <p className="max-w-[46ch] text-footnote text-muted">{hint}</p> : null}
      {action ? <div className="mt-2 flex justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/** No-results state for a filtered list. Distinct from "nothing exists yet". */
export function SearchEmpty({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <EmptyState
      icon="search"
      title={`No results for "${query}"`}
      hint="Check the spelling or clear the search to see everything."
      action={
        <Button size="sm" variant="outline" onPress={onClear}>
          <Icon name="close" size={13} />
          Clear search
        </Button>
      }
    />
  );
}

/**
 * Skeleton rows, not a centred spinner (DESIGN.md > Components > States).
 * The layout stays put when data lands, so nothing jumps under the cursor.
 */
export function LoadingBlock({ rows = 5 }: { label?: string; rows?: number }) {
  return (
    <div className="flex flex-col gap-2 p-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="h-9 animate-pulse rounded-field bg-surface-secondary"
          style={{ animationDelay: `${i * 60}ms`, opacity: 1 - i * 0.13 }}
        />
      ))}
    </div>
  );
}

export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
      <span className="sr-only">Loading</span>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="h-28 animate-pulse rounded-group bg-surface-secondary"
          style={{ animationDelay: `${i * 60}ms` }}
        />
      ))}
    </div>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert status="danger" className="my-3">
      <Alert.Content>
        <Alert.Title>Something went wrong</Alert.Title>
        <Alert.Description>{message}</Alert.Description>
      </Alert.Content>
      {onRetry ? (
        <Button size="sm" variant="outline" onPress={onRetry}>
          <Icon name="refresh" size={13} />
          Retry
        </Button>
      ) : null}
    </Alert>
  );
}

/**
 * Inline notice. Full border and a tinted fill, never a coloured side stripe
 * (DESIGN.md > Banned).
 */
export function InlineNotice({
  tone = "accent", icon, children, action,
}: {
  tone?: "accent" | "warning" | "danger" | "success";
  icon?: IconName;
  children: ReactNode;
  action?: ReactNode;
}) {
  const toneClass = {
    accent: "border-accent/25 bg-accent-soft text-foreground",
    warning: "border-warning/30 bg-warning-soft text-foreground",
    danger: "border-danger/30 bg-danger-soft text-foreground",
    success: "border-success/30 bg-success-soft text-foreground",
  }[tone];
  const iconClass = {
    accent: "text-accent", warning: "text-warning",
    danger: "text-danger", success: "text-success",
  }[tone];
  return (
    <div
      className={`mb-5 flex flex-wrap items-center gap-2.5 rounded-group border px-4 py-3 text-body ${toneClass}`}
    >
      {icon ? <Icon name={icon} size={16} className={`shrink-0 ${iconClass}`} /> : null}
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

/* ----------------------------------------------------------------- table ---- */

/** Minimal, accessible data table. HeroUI has no opinionated table shell. */
export function DataTable({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-body">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th
                key={`${h}-${i}`}
                scope="col"
                className="whitespace-nowrap border-b border-separator px-4 py-2 text-start text-caption font-semibold uppercase tracking-[0.04em] text-muted"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** Table row with the macOS hover highlight. */
export function Tr({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <tr className={`transition-colors duration-150 ease-mac hover:bg-surface-hover ${className ?? ""}`}>
      {children}
    </tr>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <td className={`border-b border-separator px-4 py-2.5 align-middle ${className ?? ""}`}>
      {children}
    </td>
  );
}

/* ------------------------------------------------------------ list rows ---- */

/**
 * A row in a grouped inset list. Separators are inset past the leading icon,
 * which is the detail that makes the structure read as native.
 */
export function ListRow({
  icon, title, subtitle, trailing, onSelect, selected,
}: {
  icon?: IconName;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onSelect?: () => void;
  selected?: boolean;
}) {
  const body = (
    <>
      {icon ? (
        <span className="grid size-7 shrink-0 place-items-center rounded-control bg-surface-secondary text-muted">
          <Icon name={icon} size={15} />
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium text-foreground">{title}</span>
        {subtitle ? (
          <span className="block truncate text-footnote text-muted">{subtitle}</span>
        ) : null}
      </span>
      {trailing ? <span className="flex shrink-0 items-center gap-2">{trailing}</span> : null}
    </>
  );

  const base =
    "flex w-full items-center gap-3 px-4 py-2.5 text-start transition-colors duration-150 ease-mac";

  if (!onSelect) return <div className={base}>{body}</div>;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={`${base} ${selected ? "bg-accent-soft" : "hover:bg-surface-hover"}`}
    >
      {body}
      <Icon name="chevronRight" size={13} className="shrink-0 text-subtle rtl:rotate-180" />
    </button>
  );
}

/** Container that draws inset separators between its rows. */
export function ListGroup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`group-panel divide-y divide-separator [&>*]:first:rounded-t-group [&>*]:last:rounded-b-group ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

/** Label / value line, as used in macOS inspector panes. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="shrink-0 text-footnote text-muted">{label}</span>
      <span className="min-w-0 truncate text-body text-foreground">{children}</span>
    </div>
  );
}
