"use client";

// SOT: screens-page, pairing-modal, bulk-publish, screen-detail
// WHAT:  the fleet view: pair a TV, assign content, publish, roll back, diagnose.
// WHY:   this is the operator's primary workspace; everything else feeds it.
// HOW:   the pairing modal completes the OTP handshake and creates the screen in one
//        request, matching the PRD's "Add New Screen" flow.
// WHERE: api.createScreen / api.bulkPublish in src/lib/api.ts

import { useState } from "react";
import { Button, Chip } from "@heroui/react";
import { api, describeError } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { useI18n, timeAgo } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { permission } from "@/lib/resources";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, SectionCard } from "@/components/global/ui";
import { FormDialog } from "@/components/global/form-dialog";
import { SelectField, TextInput, FieldRow } from "@/components/global/form";
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

  if (screens.loading && !screens.data) return <LoadingBlock label={t("common.loading")} />;
  if (screens.error) return <ErrorBlock message={screens.error} onRetry={screens.reload} />;

  const list = screens.data ?? [];
  const branchOptions = (branches.data ?? []).map((b) => ({ id: b.id, label: `${b.name} (${b.timezone})` }));
  const playlistOptions = (playlists.data ?? []).map((p) => ({ id: p.id, label: p.name }));
  const tickerOptions = (tickers.data ?? []).map((x) => ({ id: x.id, label: x.name }));

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

  return (
    <div>
      <PageHeader
        title={t("nav.screens")}
        subtitle={`${list.length} screens`}
        actions={
          <>
            <Chip color="success" variant="soft">{t("screens.online", { n: online })}</Chip>
            <Chip color="danger" variant="soft">{t("screens.offline", { n: list.length - online })}</Chip>
            {can(permission("screens", "publish")) && list.length > 0 ? (
              <Button variant="outline" onPress={() => { setBulkPlaylist(playlistOptions[0]?.id ?? ""); setBulkBranch(""); setBulkOpen(true); }}>
                {t("screens.bulk")}
              </Button>
            ) : null}
            {can(permission("screens", "create")) ? (
              <Button variant="primary" onPress={openPair}>{t("screens.add")}</Button>
            ) : null}
          </>
        }
      />

      {list.length === 0 ? (
        <EmptyState
          title={t("screens.empty")}
          hint="Open the TV player, then click Add New Screen and enter the 4-digit code."
          action={<a className="text-accent hover:underline" href="/tv" target="_blank" rel="noreferrer">Open TV player →</a>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => void openDetail(s.id)}
              className="panel p-4 text-start transition hover:border-accent"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-semibold">
                  <span aria-hidden="true" className={`size-2 rounded-full ${s.status === "online" ? "bg-success" : "bg-danger"}`} />
                  {s.name}
                </span>
                <span className="text-xs text-muted">{s.orientation}</span>
              </div>
              <p className="mt-2 text-xs text-muted">{s.branch_name ?? "—"}</p>
              <p className="mt-2 text-sm">{s.playlist_name ?? <span className="text-muted">{t("screens.no_playlist")}</span>}</p>
              {s.ticker_name ? <p className="text-xs text-muted">Ticker: {s.ticker_name}</p> : null}
              <p className="mt-2 text-xs text-muted">{t("screens.last_sync", { t: timeAgo(s.last_sync_at) })}</p>
            </button>
          ))}
        </div>
      )}

      {/* ---- Add New Screen ---- */}
      <FormDialog
        isOpen={pairOpen}
        onClose={() => setPairOpen(false)}
        title={t("screens.add").replace("+ ", "")}
        description="Enter the 4-digit code shown on the TV, then configure the screen."
        confirmLabel="Pair & go live"
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
        <TextInput label="Pairing code from TV" value={code} onChange={setCode} placeholder="0000" />
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
          description={`${detail.screen.branch_name ?? "—"} · ${detail.screen.os_type ?? "web"} · ${detail.screen.resolution ?? "unknown"}`}
          size="lg"
        >
          <div className="flex flex-wrap gap-2">
            <Chip color={detail.screen.status === "online" ? "success" : "danger"} variant="soft">{detail.screen.status}</Chip>
            <Chip variant="soft">Playlist: {detail.screen.playlist_name ?? "none"}</Chip>
            <Chip variant="soft">Source: {detail.screen.effective.source}</Chip>
            <Chip variant="soft">Synced {timeAgo(detail.screen.last_sync_at)}</Chip>
          </div>

          {detail.screen.effective.conflicts.length > 0 ? (
            <p className="rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm">
              Schedule conflict: {detail.screen.effective.conflicts.map((c) => c.name).join(", ")} — most specific target wins.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {can(permission("screens", "publish")) ? (
              <>
                <Button size="sm" variant="secondary" onPress={() => void api.publishScreen(detail.screen.id).then(() => screens.reload())}>
                  {t("screens.publish_now")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onPress={() => void api.rollbackScreen(detail.screen.id).then(() => { screens.reload(); setDetail(null); }).catch((e: unknown) => alert(describeError(e)))}
                >
                  {t("screens.rollback")}
                </Button>
              </>
            ) : null}
            {can(permission("screens", "update")) ? (
              <Button size="sm" variant="outline" onPress={() => void api.unpairScreen(detail.screen.id).then(() => { screens.reload(); setDetail(null); })}>
                {t("screens.unpair")}
              </Button>
            ) : null}
            {can(permission("screens", "delete")) ? (
              <Button size="sm" variant="danger-soft" onPress={() => void api.deleteScreen(detail.screen.id).then(() => { screens.reload(); setDetail(null); })}>
                {t("common.delete")}
              </Button>
            ) : null}
          </div>

          <SectionCard title="Recent sync events">
            <ul className="flex flex-col gap-1 text-sm">
              {detail.events.publishes.slice(0, 6).map((p) => (
                <li key={p.id} className="flex items-center gap-2">
                  <Chip variant="soft" color={p.status === "rendered" ? "success" : p.status === "delivered" ? "accent" : "warning"}>
                    {p.status}
                  </Chip>
                  <span className="text-muted">publish · {p.source}</span>
                  <span className="ms-auto text-xs text-muted">{timeAgo(p.created_at)}</span>
                </li>
              ))}
              {detail.events.status.slice(0, 8).map((e) => (
                <li key={e.id} className="flex items-center gap-2">
                  <Chip variant="soft">{e.kind}</Chip>
                  <span className="text-muted">{e.detail ?? ""}</span>
                  <span className="ms-auto text-xs text-muted">{timeAgo(e.created_at)}</span>
                </li>
              ))}
            </ul>
          </SectionCard>
        </FormDialog>
      ) : null}
    </div>
  );
}
