"use client";

// SOT: screens-page, pairing-sheet, bulk-publish, screen-detail
// WHAT:  the fleet view: pair a TV, assign content, publish, roll back, diagnose.
// WHY:   this is the operator's primary workspace; everything else feeds it.
// HOW:   the pairing sheet completes the OTP handshake and creates the screen in one
//        request, matching the PRD's "Add New Screen" flow. Screens render as a
//        grouped inset list so status, content and sync age read down one column.
// WHERE: api.createScreen / api.bulkPublish in src/lib/api.ts

import { useState } from "react";
import { Button } from "@heroui/react";
import { api, describeError } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { useI18n, timeAgo } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { permission } from "@/lib/resources";
import { Icon } from "@/components/global/icon";
import {
  DetailRow, EmptyState, ErrorBlock, InlineNotice, PageHeader, SearchEmpty,
  SectionCard, SkeletonGrid, StatusPill,
} from "@/components/global/ui";
import { FormDialog } from "@/components/global/form-dialog";
import { SearchField, SelectField, TextInput, FieldRow } from "@/components/global/form";
import type { Screen, ScreenEvents } from "@/lib/types";

export default function ScreensPage() {
  const { t } = useI18n();
  const { can } = useAuth();

  const screens = useQuery(() => api.screens());
  const branches = useQuery(() => api.branches());
  const playlists = useQuery(() => api.playlists());
  const tickers = useQuery(() => api.tickers());

  const [pairOpen, setPairOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [detail, setDetail] = useState<{ screen: Screen; events: ScreenEvents } | null>(null);
  const [query, setQuery] = useState("");

  // pairing form
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [branchId, setBranchId] = useState("");
  const [playlistId, setPlaylistId] = useState("");
  const [tickerId, setTickerId] = useState("");
  const [orientation, setOrientation] = useState("landscape");
  const [locationTag, setLocationTag] = useState("");

  // bulk form
  const [bulkPlaylist, setBulkPlaylist] = useState("");
  const [bulkBranch, setBulkBranch] = useState("");

  if (screens.loading && !screens.data) return <SkeletonGrid count={6} />;
  if (screens.error) return <ErrorBlock message={screens.error} onRetry={screens.reload} />;

  const list = screens.data ?? [];
  const branchOptions = (branches.data ?? []).map((b) => ({ id: b.id, label: `${b.name} (${b.timezone})` }));
  const playlistOptions = (playlists.data ?? []).map((p) => ({ id: p.id, label: p.name }));
  const tickerOptions = (tickers.data ?? []).map((x) => ({ id: x.id, label: x.name }));

  const q = query.trim().toLowerCase();
  const filtered = q
    ? list.filter((s) =>
        [s.name, s.branch_name, s.playlist_name, s.location_tag]
          .some((v) => v?.toLowerCase().includes(q)))
    : list;

  const openPair = () => {
    setCode(""); setName(""); setLocationTag("");
    setBranchId(branchOptions[0]?.id ?? "");
    setPlaylistId(""); setTickerId(""); setOrientation("landscape");
    setPairOpen(true);
  };

  const openDetail = async (id: string) => {
    const [screen, events] = await Promise.all([api.screen(id), api.screenEvents(id)]);
    setDetail({ screen, events });
  };

  const online = list.filter((s) => s.status === "online").length;
  const offline = list.length - online;

  return (
    <div>
      <PageHeader
        title={t("nav.screens")}
        subtitle={`${list.length} paired`}
        actions={
          <>
            {list.length > 0 ? (
              <>
                <StatusPill tone="success" icon="online">
                  {t("screens.online", { n: online })}
                </StatusPill>
                {offline > 0 ? (
                  <StatusPill tone="danger" icon="offline">
                    {t("screens.offline", { n: offline })}
                  </StatusPill>
                ) : null}
                <SearchField
                  ariaLabel={t("common.search")}
                  placeholder={t("common.search")}
                  value={query}
                  onChange={setQuery}
                  className="w-[180px]"
                />
              </>
            ) : null}
            {can(permission("screens", "publish")) && list.length > 0 ? (
              <Button variant="outline" size="sm" onPress={() => { setBulkPlaylist(playlistOptions[0]?.id ?? ""); setBulkBranch(""); setBulkOpen(true); }}>
                <Icon name="publish" size={13} />
                {t("screens.bulk")}
              </Button>
            ) : null}
            {can(permission("screens", "create")) ? (
              <Button variant="primary" size="sm" onPress={openPair}>
                <Icon name="add" size={13} />
                {t("screens.add")}
              </Button>
            ) : null}
          </>
        }
      />

      {list.length === 0 ? (
        <SectionCard flush>
          <EmptyState
            icon="tv"
            title={t("screens.empty")}
            hint="Open the TV player, then click Add New Screen and enter the 4-digit code it shows."
            action={
              <>
                <Button variant="outline" size="sm" onPress={() => { window.open("/tv", "_blank"); }}>
                  <Icon name="tv" size={13} />
                  {t("action.opentv")}
                </Button>
                {can(permission("screens", "create")) ? (
                  <Button variant="primary" size="sm" onPress={openPair}>
                    <Icon name="add" size={13} />
                    {t("screens.add")}
                  </Button>
                ) : null}
              </>
            }
          />
        </SectionCard>
      ) : filtered.length === 0 ? (
        <SectionCard flush>
          <SearchEmpty query={query} onClear={() => setQuery("")} />
        </SectionCard>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((s) => {
            const isOnline = s.status === "online";
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => void openDetail(s.id)}
                className="group-panel flex flex-col gap-3 p-4 text-start transition-colors duration-150 ease-mac hover:bg-surface-hover"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={`size-[7px] shrink-0 rounded-full ${isOnline ? "bg-success" : "bg-danger"}`}
                    />
                    <span className="truncate text-callout font-semibold text-foreground">
                      {s.name}
                    </span>
                  </span>
                  <span className="shrink-0 text-caption text-subtle">{s.orientation}</span>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="flex items-center gap-1.5 text-footnote text-muted">
                    <Icon name="branches" size={12} />
                    <span className="truncate">{s.branch_name ?? "No branch"}</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-footnote">
                    <Icon name="playlists" size={12} className="text-muted" />
                    <span className={`truncate ${s.playlist_name ? "text-foreground" : "text-muted"}`}>
                      {s.playlist_name ?? t("screens.no_playlist")}
                    </span>
                  </span>
                  {s.ticker_name ? (
                    <span className="flex items-center gap-1.5 text-footnote text-muted">
                      <Icon name="tickers" size={12} />
                      <span className="truncate">{s.ticker_name}</span>
                    </span>
                  ) : null}
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-separator pt-2.5">
                  <span className="text-caption text-subtle">
                    {t("screens.last_sync", { t: timeAgo(s.last_sync_at) })}
                  </span>
                  <Icon name="chevronRight" size={12} className="text-subtle rtl:rotate-180" />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ---- Add New Screen ---- */}
      <FormDialog
        isOpen={pairOpen}
        onClose={() => setPairOpen(false)}
        title={t("screens.add")}
        description="Enter the 4-digit code shown on the TV, then configure the screen."
        icon="tv"
        confirmLabel="Pair and go live"
        onConfirm={async () => {
          await api.createScreen({
            code: code.trim() || undefined,
            name: name.trim(),
            branch_id: branchId,
            playlist_id: playlistId || null,
            ticker_id: tickerId || null,
            orientation,
            location_tag: locationTag || null,
          });
          screens.reload();
        }}
      >
        <TextInput
          label="Pairing code from TV"
          value={code}
          onChange={setCode}
          placeholder="0000"
          description="The code expires after 3 minutes. Reload the TV player for a new one."
        />
        <TextInput label="Screen name" value={name} onChange={setName} placeholder="Front Counter Display" />
        <SelectField label="Branch" options={branchOptions} selected={branchId} onSelect={setBranchId} />
        <FieldRow>
          <SelectField label="Playlist" options={[{ id: "", label: "No playlist" }, ...playlistOptions]} selected={playlistId} onSelect={setPlaylistId} />
          <SelectField label="Flash news" options={[{ id: "", label: "None" }, ...tickerOptions]} selected={tickerId} onSelect={setTickerId} />
        </FieldRow>
        <FieldRow>
          <SelectField
            label="Orientation"
            options={[{ id: "landscape", label: "Landscape" }, { id: "portrait", label: "Portrait" }]}
            selected={orientation}
            onSelect={setOrientation}
          />
          <TextInput label="Location tag" value={locationTag} onChange={setLocationTag} placeholder="Near entrance" />
        </FieldRow>
      </FormDialog>

      {/* ---- Bulk publish ---- */}
      <FormDialog
        isOpen={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title={t("screens.bulk")}
        description="Assign one playlist to many screens and push instantly."
        icon="publish"
        confirmLabel="Publish now"
        onConfirm={async () => {
          await api.bulkPublish(
            bulkBranch
              ? { playlist_id: bulkPlaylist, branch_ids: [bulkBranch] }
              : { playlist_id: bulkPlaylist, all: true },
          );
          screens.reload();
        }}
      >
        <SelectField label="Playlist" options={playlistOptions} selected={bulkPlaylist} onSelect={setBulkPlaylist} />
        <SelectField
          label="Target"
          options={[{ id: "", label: "All branches" }, ...branchOptions]}
          selected={bulkBranch}
          onSelect={setBulkBranch}
        />
      </FormDialog>

      {/* ---- Screen detail ---- */}
      {detail ? (
        <FormDialog
          isOpen
          onClose={() => setDetail(null)}
          title={detail.screen.name}
          description={detail.screen.branch_name ?? "No branch"}
          icon="screens"
          size="lg"
          cancelLabel={t("common.close")}
        >
          <div className="flex flex-wrap gap-1.5">
            <StatusPill
              tone={detail.screen.status === "online" ? "success" : "danger"}
              icon={detail.screen.status === "online" ? "online" : "offline"}
            >
              {detail.screen.status}
            </StatusPill>
            <StatusPill tone="neutral" icon="time">
              Synced {timeAgo(detail.screen.last_sync_at)}
            </StatusPill>
          </div>

          <div className="group-panel px-4 py-1">
            <DetailRow label="Playlist">{detail.screen.playlist_name ?? "None"}</DetailRow>
            <DetailRow label="Content source">{detail.screen.effective.source}</DetailRow>
            <DetailRow label="Device">{detail.screen.os_type ?? "web"}</DetailRow>
            <DetailRow label="Resolution">{detail.screen.resolution ?? "unknown"}</DetailRow>
            <DetailRow label="Orientation">{detail.screen.orientation}</DetailRow>
          </div>

          {detail.screen.effective.conflicts.length > 0 ? (
            <InlineNotice icon="warning" tone="warning">
              Schedule conflict:{" "}
              {detail.screen.effective.conflicts.map((c) => c.name).join(", ")}. The most
              specific target wins.
            </InlineNotice>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {can(permission("screens", "publish")) ? (
              <>
                <Button size="sm" variant="secondary" onPress={() => void api.publishScreen(detail.screen.id).then(() => screens.reload())}>
                  <Icon name="publish" size={13} />
                  {t("screens.publish_now")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onPress={() => void api.rollbackScreen(detail.screen.id).then(() => { screens.reload(); setDetail(null); }).catch((e: unknown) => alert(describeError(e)))}
                >
                  <Icon name="rollback" size={13} />
                  {t("screens.rollback")}
                </Button>
              </>
            ) : null}
            {can(permission("screens", "update")) ? (
              <Button size="sm" variant="outline" onPress={() => void api.unpairScreen(detail.screen.id).then(() => { screens.reload(); setDetail(null); })}>
                <Icon name="unpair" size={13} />
                {t("screens.unpair")}
              </Button>
            ) : null}
            {can(permission("screens", "delete")) ? (
              <Button size="sm" variant="danger-soft" onPress={() => void api.deleteScreen(detail.screen.id).then(() => { screens.reload(); setDetail(null); })}>
                <Icon name="delete" size={13} />
                {t("common.delete")}
              </Button>
            ) : null}
          </div>

          <SectionCard flush title="Recent sync events">
            <ul className="divide-y divide-separator">
              {detail.events.publishes.slice(0, 6).map((p) => (
                <li key={p.id} className="flex items-center gap-2 px-4 py-2">
                  <StatusPill
                    tone={p.status === "rendered" ? "success" : p.status === "delivered" ? "accent" : "warning"}
                    icon={p.status === "rendered" ? "success" : p.status === "delivered" ? "check" : "pending"}
                  >
                    {p.status}
                  </StatusPill>
                  <span className="truncate text-footnote text-muted">publish · {p.source}</span>
                  <span className="ms-auto shrink-0 text-footnote text-subtle">{timeAgo(p.created_at)}</span>
                </li>
              ))}
              {detail.events.status.slice(0, 8).map((e) => (
                <li key={e.id} className="flex items-center gap-2 px-4 py-2">
                  <StatusPill tone="neutral">{e.kind}</StatusPill>
                  <span className="truncate text-footnote text-muted">{e.detail ?? ""}</span>
                  <span className="ms-auto shrink-0 text-footnote text-subtle">{timeAgo(e.created_at)}</span>
                </li>
              ))}
            </ul>
          </SectionCard>
        </FormDialog>
      ) : null}
    </div>
  );
}
