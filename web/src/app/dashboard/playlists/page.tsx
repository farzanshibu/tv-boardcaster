"use client";

// SOT: playlists-page, playlist-builder
// WHAT:  create and reorder playlists, preview them, and send them for approval.
// WHY:   a playlist is the unit screens actually play.
// HOW:   drag-and-drop reordering over a local array, saved in one PATCH.
// WHERE: api.createPlaylist / api.updatePlaylist

import { useState } from "react";
import { Button, Chip } from "@heroui/react";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { permission } from "@/lib/resources";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/global/ui";
import { FormDialog } from "@/components/global/form-dialog";
import { SelectField, TextInput } from "@/components/global/form";
import type { Playlist } from "@/lib/types";

interface DraftItem { media_id: string; duration: number }

export default function PlaylistsPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const playlists = useQuery(() => api.playlists());
  const media = useQuery(() => api.media());

  const [editing, setEditing] = useState<Playlist | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [picker, setPicker] = useState("");
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  if (playlists.loading && !playlists.data) return <LoadingBlock label={t("common.loading")} />;
  if (playlists.error) return <ErrorBlock message={playlists.error} onRetry={playlists.reload} />;

  const list = playlists.data ?? [];
  const assets = media.data ?? [];
  const nameOf = (id: string) => assets.find((m) => m.id === id)?.name ?? "missing";

  const openEditor = (p: Playlist | null) => {
    setEditing(p);
    setName(p?.name ?? "");
    setItems(p ? p.items.map((i) => ({ media_id: i.media_id, duration: i.duration })) : []);
    setPicker("");
    setOpen(true);
  };

  const move = (from: number, to: number) => {
    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      if (moved) next.splice(to, 0, moved);
      return next;
    });
  };

  return (
    <div>
      <PageHeader
        title={t("nav.playlists")}
        subtitle={`${list.length} playlists`}
        actions={can(permission("playlists", "create")) ? (
          <Button variant="primary" onPress={() => openEditor(null)}>{t("playlists.new")}</Button>
        ) : null}
      />

      {list.length === 0 ? (
        <EmptyState title={t("playlists.empty")} hint="Create one to assign to your screens." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map((p) => (
            <div key={p.id} className="panel p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">{p.name}</p>
                {p.status !== "approved" ? <Chip color="warning" variant="soft">pending</Chip> : null}
              </div>
              <p className="mt-1 text-xs text-muted">{p.items.length} items · {p.total_duration}s loop</p>
              <div className="mt-3 flex gap-2 overflow-hidden">
                {p.items.slice(0, 5).map((i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i.media_id} src={i.media.url} alt="" className="h-9 w-14 rounded object-cover" />
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {can(permission("playlists", "update")) ? (
                  <Button size="sm" variant="outline" onPress={() => openEditor(p)}>{t("common.edit")}</Button>
                ) : null}
                {p.status !== "approved" && can(permission("playlists", "approve")) ? (
                  <Button size="sm" variant="secondary" onPress={() => void api.approvePlaylist(p.id).then(playlists.reload)}>
                    {t("common.approve")}
                  </Button>
                ) : null}
                {can(permission("playlists", "delete")) ? (
                  <Button size="sm" variant="danger-soft" onPress={() => void api.deletePlaylist(p.id).then(playlists.reload).catch(() => undefined)}>
                    {t("common.delete")}
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <FormDialog
        isOpen={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit playlist" : "New playlist"}
        description="Drag items to reorder. Duration applies to images; video plays in full."
        size="lg"
        confirmLabel={editing ? "Save changes" : "Create playlist"}
        onConfirm={async () => {
          const body = { name: name.trim(), items };
          if (editing) await api.updatePlaylist(editing.id, body);
          else await api.createPlaylist(body);
          playlists.reload();
        }}
      >
        <TextInput label="Playlist name" value={name} onChange={setName} placeholder="Morning promos" />

        <div className="flex flex-col gap-2">
          {items.length === 0 ? <p className="text-sm text-muted">Add media below.</p> : null}
          {items.map((item, idx) => (
            <div
              key={`${item.media_id}-${idx}`}
              draggable
              onDragStart={() => setDragFrom(idx)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); if (dragFrom !== null) move(dragFrom, idx); setDragFrom(null); }}
              className="flex items-center gap-3 rounded-lg border border-border bg-surface-secondary p-2"
            >
              <span aria-hidden="true" className="cursor-grab text-muted">⠿</span>
              <span className="flex-1 truncate text-sm">{nameOf(item.media_id)}</span>
              <input
                aria-label={`Duration for ${nameOf(item.media_id)}`}
                type="number"
                min={1}
                value={item.duration}
                onChange={(e) => setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, duration: Number(e.target.value) } : x)))}
                className="w-20 rounded-md border border-border bg-field px-2 py-1 text-sm"
              />
              <Button size="sm" variant="danger-soft" onPress={() => setItems((prev) => prev.filter((_, i) => i !== idx))}>✕</Button>
            </div>
          ))}
        </div>

        <SelectField
          label="Add media"
          options={[{ id: "", label: "Choose an asset…" }, ...assets.map((m) => ({ id: m.id, label: `${m.name} (${m.type})` }))]}
          selected={picker}
          onSelect={(id) => {
            const asset = assets.find((m) => m.id === id);
            if (asset) setItems((prev) => [...prev, { media_id: asset.id, duration: asset.duration }]);
            setPicker("");
          }}
        />
      </FormDialog>
    </div>
  );
}
