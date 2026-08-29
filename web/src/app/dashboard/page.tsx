"use client";

// SOT: overview-page, fleet-summary
// WHAT:  the landing view: fleet counts, screen health and recent activity.
// WHY:   a signage operator's first question is "is everything playing?".
// HOW:   useQuery re-runs whenever the live WebSocket reports a screen change.
// WHERE: data from api.overview() and api.screens()

import Link from "next/link";
import { Chip } from "@heroui/react";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { useI18n, timeAgo, formatNumber } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import {
  DataTable, EmptyState, ErrorBlock, LoadingBlock, PageHeader, SectionCard, StatCard, Td,
} from "@/components/global/ui";

export default function OverviewPage() {
  const { t, locale } = useI18n();
  const { session } = useAuth();
  const overview = useQuery(() => api.overview());
  const screens = useQuery(() => api.screens());

  if (overview.loading && !overview.data) return <LoadingBlock label={t("common.loading")} />;
  if (overview.error) return <ErrorBlock message={overview.error} onRetry={overview.reload} />;
  if (!overview.data) return null;

  const o = overview.data;
  const plan = o.plan;
  const nearLimit = plan.max_screens > 0 && o.usage.screens >= plan.max_screens * 0.8;

  return (
    <div>
      <PageHeader title={t("nav.overview")} subtitle={session?.org?.name ?? ""} />

      {nearLimit ? (
        <div className="mb-5 rounded-xl border border-accent/40 bg-accent-soft p-4 text-sm">
          You are using {o.usage.screens} of {plan.max_screens} screens on {plan.name}.{" "}
          <Link href="/dashboard/billing" className="font-semibold text-accent hover:underline">
            Upgrade your plan →
          </Link>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("stat.total_screens")} value={formatNumber(o.total_screens, locale)} hint={`${o.branches} branches`} />
        <StatCard
          label={t("stat.online_now")}
          value={formatNumber(o.online_screens, locale)}
          hint={`${o.offline_screens} offline`}
          tone={o.offline_screens > 0 ? "warning" : "success"}
        />
        <StatCard label={t("stat.playlists")} value={formatNumber(o.playlists, locale)} hint={`${o.media} media assets`} />
        <StatCard label={t("stat.publishes")} value={formatNumber(o.publishes_24h, locale)} hint={plan.name} />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <SectionCard
          title={t("nav.screens")}
          actions={<Link href="/dashboard/screens" className="text-sm text-accent hover:underline">View all</Link>}
        >
          {screens.data && screens.data.length > 0 ? (
            <DataTable head={["Screen", "Playlist", "Last sync"]}>
              {screens.data.slice(0, 8).map((s) => (
                <tr key={s.id}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={`size-2 rounded-full ${s.status === "online" ? "bg-success" : "bg-danger"}`}
                      />
                      <div>
                        <p className="font-medium">{s.name}</p>
                        <p className="text-xs text-muted">{s.branch_name ?? "—"}</p>
                      </div>
                    </div>
                  </Td>
                  <Td className="text-muted">{s.playlist_name ?? t("screens.no_playlist")}</Td>
                  <Td className="text-muted">{timeAgo(s.last_sync_at)}</Td>
                </tr>
              ))}
            </DataTable>
          ) : (
            <EmptyState title={t("screens.empty")} />
          )}
        </SectionCard>

        <SectionCard title="Recent activity">
          {o.recent_activity.length > 0 ? (
            <ul className="flex flex-col">
              {o.recent_activity.map((a, i) => (
                <li key={`${a.action}-${i}`} className="flex flex-wrap items-center gap-2 border-b border-border py-2 last:border-0">
                  <Chip variant="soft" color="accent">{a.action}</Chip>
                  <span className="text-sm text-muted">{a.actor_email ?? "system"}</span>
                  <span className="ms-auto text-xs text-muted">{timeAgo(a.created_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No activity yet." />
          )}
        </SectionCard>
      </div>
    </div>
  );
}
