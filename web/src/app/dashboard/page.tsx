"use client";

// SOT: overview-page, fleet-summary
// WHAT:  the landing view: fleet counts, screen health and recent activity.
// WHY:   a signage operator's first question is "is everything playing?", so screen
//        health owns the strongest position and the only saturated colour on the page.
// HOW:   useQuery re-runs whenever the live WebSocket reports a screen change.
// WHERE: data from api.overview() and api.screens()

import Link from "next/link";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { useI18n, timeAgo, formatNumber } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { Icon } from "@/components/global/icon";
import {
  DataTable, EmptyState, ErrorBlock, InlineNotice, LoadingBlock, PageHeader,
  SectionCard, StatCard, StatusPill, StatusDot, Td, Tr,
} from "@/components/global/ui";

export default function OverviewPage() {
  const { t, locale } = useI18n();
  const { session } = useAuth();
  const overview = useQuery(() => api.overview());
  const screens = useQuery(() => api.screens());

  if (overview.loading && !overview.data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-[92px] animate-pulse rounded-group bg-surface-secondary" />
        ))}
      </div>
    );
  }
  if (overview.error) return <ErrorBlock message={overview.error} onRetry={overview.reload} />;
  if (!overview.data) return null;

  const o = overview.data;
  const plan = o.plan;
  const nearLimit = plan.max_screens > 0 && o.usage.screens >= plan.max_screens * 0.8;
  const allOnline = o.offline_screens === 0 && o.total_screens > 0;

  return (
    <div>
      <PageHeader
        title={t("nav.overview")}
        subtitle={session?.org?.name ?? ""}
        actions={
          o.total_screens > 0 ? (
            <StatusPill
              tone={allOnline ? "success" : "warning"}
              icon={allOnline ? "success" : "warning"}
            >
              {allOnline
                ? "All screens playing"
                : t("screens.offline", { n: o.offline_screens })}
            </StatusPill>
          ) : null
        }
      />

      {nearLimit ? (
        <InlineNotice
          icon="warning"
          tone="warning"
          action={
            <Link
              href="/dashboard/billing"
              className="inline-flex shrink-0 items-center gap-1 text-body font-medium text-accent hover:underline"
            >
              Upgrade plan
              <Icon name="chevronRight" size={12} className="rtl:rotate-180" />
            </Link>
          }
        >
          Using {o.usage.screens} of {plan.max_screens} screens on {plan.name}.
        </InlineNotice>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon="screens"
          label={t("stat.total_screens")}
          value={formatNumber(o.total_screens, locale)}
          hint={`${o.branches} branches`}
        />
        <StatCard
          icon={o.offline_screens > 0 ? "offline" : "online"}
          label={t("stat.online_now")}
          value={formatNumber(o.online_screens, locale)}
          hint={`${o.offline_screens} offline`}
          tone={o.offline_screens > 0 ? "warning" : "success"}
        />
        <StatCard
          icon="playlists"
          label={t("stat.playlists")}
          value={formatNumber(o.playlists, locale)}
          hint={`${o.media} media assets`}
        />
        <StatCard
          icon="publish"
          label={t("stat.publishes")}
          value={formatNumber(o.publishes_24h, locale)}
          hint={plan.name}
        />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <SectionCard
          flush
          title={t("nav.screens")}
          actions={
            <Link
              href="/dashboard/screens"
              className="inline-flex items-center gap-1 text-footnote font-medium text-accent hover:underline"
            >
              View all
              <Icon name="chevronRight" size={11} className="rtl:rotate-180" />
            </Link>
          }
        >
          {screens.loading && !screens.data ? (
            <LoadingBlock rows={5} />
          ) : screens.data && screens.data.length > 0 ? (
            <DataTable head={["Screen", "Playlist", "Last sync"]}>
              {screens.data.slice(0, 8).map((s) => (
                <Tr key={s.id}>
                  <Td>
                    <StatusDot online={s.status === "online"} label={s.name} />
                    <p className="ps-[15px] text-footnote text-muted">{s.branch_name ?? "No branch"}</p>
                  </Td>
                  <Td className="text-muted">{s.playlist_name ?? t("screens.no_playlist")}</Td>
                  <Td className="text-footnote text-muted">{timeAgo(s.last_sync_at)}</Td>
                </Tr>
              ))}
            </DataTable>
          ) : (
            <EmptyState
              icon="screens"
              title={t("screens.empty")}
              hint="Open the TV player and pair your first display."
            />
          )}
        </SectionCard>

        <SectionCard flush title="Recent activity">
          {o.recent_activity.length > 0 ? (
            <ul className="divide-y divide-separator">
              {o.recent_activity.map((a, i) => (
                <li
                  key={`${a.action}-${i}`}
                  className="flex flex-wrap items-center gap-2 px-4 py-2.5"
                >
                  <StatusPill tone="accent">{a.action}</StatusPill>
                  <span className="min-w-0 truncate text-footnote text-muted">
                    {a.actor_email ?? "system"}
                  </span>
                  <span className="ms-auto shrink-0 text-footnote text-subtle">
                    {timeAgo(a.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon="audit"
              title="No activity yet"
              hint="Publishes and admin actions appear here."
            />
          )}
        </SectionCard>
      </div>
    </div>
  );
}
