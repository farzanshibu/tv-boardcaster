"use client";

// SOT: analytics-page, uptime-report, content-performance
// WHAT:  fleet uptime and play counts, exportable as CSV.
// WHY:   the PRD sets a 99.5% screen-uptime target that has to be observable.
// HOW:   uptime is derived server-side from status transitions. The per-screen bar
//        is tinted by whether that screen clears the target, so a bad row is
//        visible without reading the number.
// WHERE: src/routes/insights.js

import { Button } from "@heroui/react";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { useI18n, formatNumber } from "@/lib/i18n";
import { Icon } from "@/components/global/icon";
import {
  DataTable, EmptyState, ErrorBlock, LoadingBlock, PageHeader, SectionCard,
  StatCard, StatusPill, Td, Tr,
} from "@/components/global/ui";

const UPTIME_TARGET = 99.5;

export default function AnalyticsPage() {
  const { t, locale } = useI18n();
  const uptime = useQuery(() => api.uptime());
  const content = useQuery(() => api.contentReport());
  const overview = useQuery(() => api.overview());

  if (uptime.loading && !uptime.data) return <LoadingBlock rows={6} />;
  if (uptime.error) return <ErrorBlock message={uptime.error} onRetry={uptime.reload} />;
  if (!uptime.data) return null;

  const rows = uptime.data.screens;
  const plays = content.data?.by_media ?? [];
  const totalPlays = plays.reduce((a, m) => a + m.plays, 0);
  const totalSeconds = plays.reduce((a, m) => a + (m.seconds ?? 0), 0);
  const meetsTarget = uptime.data.fleet_uptime_pct >= UPTIME_TARGET;

  const exportCsv = () => {
    const csv = [
      ["screen", "branch", "uptime_pct", "online_hours", "status"],
      ...rows.map((r) => [r.screen, r.branch ?? "", r.uptime_pct, r.online_hours, r.current_status]),
    ].map((r) => r.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "brandcast-uptime.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        title={t("nav.analytics")}
        subtitle="Last 30 days"
        actions={
          <StatusPill
            tone={meetsTarget ? "success" : "warning"}
            icon={meetsTarget ? "success" : "warning"}
          >
            {meetsTarget ? "Meeting uptime target" : "Below uptime target"}
          </StatusPill>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon="analytics"
          label={t("analytics.fleet_uptime")}
          value={`${uptime.data.fleet_uptime_pct}%`}
          hint={`Target ${UPTIME_TARGET}%`}
          tone={meetsTarget ? "success" : "warning"}
        />
        <StatCard
          icon="screens"
          label={t("stat.total_screens")}
          value={formatNumber(overview.data?.total_screens ?? 0, locale)}
          hint={`${overview.data?.online_screens ?? 0} online`}
        />
        <StatCard icon="media" label="Total plays" value={formatNumber(totalPlays, locale)} />
        <StatCard
          icon="time"
          label="Play time"
          value={`${Math.round(totalSeconds / 3600)}h`}
          hint="Cumulative"
        />
      </div>

      <SectionCard
        flush
        className="mt-5"
        title={t("analytics.screen_uptime")}
        actions={
          <Button size="sm" variant="outline" onPress={exportCsv}>
            <Icon name="download" size={13} />
            {t("common.export")}
          </Button>
        }
      >
        {rows.length === 0 ? (
          <EmptyState
            icon="analytics"
            title="No screens to report on"
            hint="Pair a screen and uptime starts accruing immediately."
          />
        ) : (
          <DataTable head={["Screen", "Branch", "Uptime", "Online hours", "Status"]}>
            {rows.map((r) => {
              const healthy = r.uptime_pct >= UPTIME_TARGET;
              return (
                <Tr key={r.screen_id}>
                  <Td className="font-medium">{r.screen}</Td>
                  <Td className="text-muted">{r.branch ?? "No branch"}</Td>
                  <Td>
                    <p className="tabular-nums">{r.uptime_pct}%</p>
                    <div
                      className="mt-1 h-1 w-28 overflow-hidden rounded-full bg-surface-secondary"
                      role="presentation"
                    >
                      <div
                        className={`h-full rounded-full ${healthy ? "bg-success" : "bg-warning"}`}
                        style={{ width: `${Math.min(100, Math.max(0, r.uptime_pct))}%` }}
                      />
                    </div>
                  </Td>
                  <Td className="tabular-nums text-muted">{r.online_hours}</Td>
                  <Td>
                    <StatusPill
                      tone={r.current_status === "online" ? "success" : "danger"}
                      icon={r.current_status === "online" ? "online" : "offline"}
                    >
                      {r.current_status}
                    </StatusPill>
                  </Td>
                </Tr>
              );
            })}
          </DataTable>
        )}
      </SectionCard>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <SectionCard flush title={t("analytics.top_media")}>
          {plays.length === 0 ? (
            <EmptyState
              icon="media"
              title="No play data yet"
              hint="Pair a screen and let it run; plays report back over the socket."
            />
          ) : (
            <DataTable head={["Media", "Type", "Plays", "Minutes"]}>
              {plays.slice(0, 10).map((m) => (
                <Tr key={m.media_id}>
                  <Td>{m.media?.name ?? m.media_id}</Td>
                  <Td className="text-muted">{m.media?.type ?? ""}</Td>
                  <Td className="tabular-nums">{m.plays}</Td>
                  <Td className="tabular-nums text-muted">{Math.round((m.seconds ?? 0) / 60)}</Td>
                </Tr>
              ))}
            </DataTable>
          )}
        </SectionCard>

        <SectionCard flush title={t("analytics.playlist_perf")}>
          {(content.data?.by_playlist ?? []).length === 0 ? (
            <EmptyState icon="playlists" title="No playlist data yet" />
          ) : (
            <DataTable head={["Playlist", "Plays", "Minutes"]}>
              {(content.data?.by_playlist ?? []).slice(0, 10).map((p) => (
                <Tr key={p.playlist_id}>
                  <Td>{p.playlist?.name ?? "Unknown"}</Td>
                  <Td className="tabular-nums">{p.plays}</Td>
                  <Td className="tabular-nums text-muted">{Math.round((p.seconds ?? 0) / 60)}</Td>
                </Tr>
              ))}
            </DataTable>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
