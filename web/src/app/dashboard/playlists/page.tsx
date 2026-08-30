"use client";

// SOT: playlists-page, playlist-builder
// WHAT:  create and reorder playlists, preview them, and send them for approval.
// WHY:   a playlist is the unit screens actually play.
// HOW:   drag-and-drop reordering over a local array, saved in one PATCH. Rows also
//        expose keyboard move controls, since drag alone fails WCAG 2.1.
// WHERE: api.createPlaylist / api.updatePlaylist

import { useState } from "react";
import { Button } from "@heroui/react";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { permission } from "@/lib/resources";
import { Icon } from "@/components/global/icon";
import {
  EmptyState, ErrorBlock, PageHeader, SectionCard, SkeletonGrid, StatusPill,
} from "@/components/global/ui";
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

  if (playlists.loading && !playlists.data) return <SkeletonGrid count={4} />;
  if (playlists.error) return <ErrorBlock message={playlists.error} onRetry={playlists.reload} />;

  const list = playlists.data ?? [];
  const assets = media.data ?? [];
  const nameOf = (id: string) => assets.find((m) => m.id === id)?.name ?? "Missing asset";

  const openEditor = (p: Playlist | null) => {
    setEditing(p);
    setName(p?.name ?? "");
    setItems(p ? p.items.map((i) => ({ media_id: i.media_id, duration: i.duration })) : []);
    setPicker("");
    setOpen(true);
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      if (moved) next.splice(to, 0, moved);
      return next;
    });
  };

  const totalDuration = items.reduce((a, i) => a + (i.duration || 0), 0);

  return (
    <div>
      <PageHeader
        title={t("nav.playlists")}
        subtitle={`${list.length} playlists`}
        actions={can(permission("playlists", "create")) ? (
          <Button variant="primary" size="sm" onPress={() => openEditor(null)}>
            <Icon name="add" size={13} />
            {t("playlists.new")}
          </Button>
        ) : null}
      />

      {list.length === 0 ? (
        <SectionCard flush>
          <EmptyState
            icon="playlists"
            title={t("playlists.empty")}
            hint="A playlist is the loop your screens play. Create one and assign it."
            action={can(permission("playlists", "create")) ? (
              <Button variant="primary" size="sm" onPress={() => openEditor(null)}>
                <Icon name="add" size={13} />
                {t("playlists.new")}
              </Button>
            ) : null}
          />
        </SectionCard>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map((p) => (
            <div key={p.id} className="group-panel flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-callout font-semibold text-foreground">{p.name}</p>
                  <p className="text-footnote text-muted">
                    {p.items.length} items · {p.total_duration}s loop
                  </p>
                </div>
                {p.status === "approved" ? (
                  <StatusPill tone="success" icon="approved">Approved</StatusPill>
                ) : (
                  <StatusPill tone="warning" icon="time">Pending</StatusPill>
                )}
              </div>

              {p.items.length > 0 ? (
                <div className="flex gap-1.5 overflow-hidden">
                  {p.items.slice(0, 6).map((i, idx) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={`${i.media_id}-${idx}`}
                      src={i.media.url}
                      alt=""
                      className="h-10 w-16 shrink-0 rounded-control border border-border object-cover"
                    />
                  ))}
                  {p.items.length > 6 ? (
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-surface-secondary text-caption font-medium text-muted">
                      +{p.items.length - 6}
                    </span>
                  ) : null}
                </div>
              ) : (
                <p className="text-footnote text-subtle">No items yet.</p>
              )}

              <div className="flex flex-wrap gap-2 border-t border-separator pt-3">
                {can(permission("playlists", "update")) ? (
                  <Button size="sm" variant="outline" onPress={() => openEditor(p)}>
                    <Icon name="edit" size={13} />
                    {t("common.edit")}
                  </Button>
                ) : null}
                {p.status !== "approved" && can(permission("playlists", "approve")) ? (
                  <Button size="sm" variant="secondary" onPress={() => void api.approvePlaylist(p.id).then(playlists.reload)}>
                    <Icon name="approved" size={13} />
                    {t("common.approve")}
                  </Button>
                ) : null}
                {can(permission("playlists", "delete")) ? (
                  <Button size="sm" variant="danger-soft" className="ms-auto" onPress={() => void api.deletePlaylist(p.id).then(playlists.reload).catch(() => undefined)}>
                    <Icon name="delete" size={13} />
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
        description="Drag to reorder, or use the arrows. Duration applies to images; video plays in full."
        icon="playlists"
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
          <div className="flex items-baseline justify-between">
            <span className="text-body font-medium text-foreground">Items</span>
            {items.length > 0 ? (
              <span className="text-footnote tabular-nums text-muted">
                {items.length} items · {totalDuration}s loop
              </span>
            ) : null}
          </div>

          {items.length === 0 ? (
            <p className="rounded-field border border-dashed border-border px-3.5 py-4 text-center text-footnote text-muted">
              No items yet. Add media below.
            </p>
          ) : null}

          {items.map((item, idx) => (
            <div
              key={`${item.media_id}-${idx}`}
              draggable
              onDragStart={() => setDragFrom(idx)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); if (dragFrom !== null) move(dragFrom, idx); setDragFrom(null); }}
              className="flex items-center gap-2.5 rounded-field border border-border bg-surface-secondary p-2 ps-2.5"
            >
              <Icon name="drag" size={15} className="shrink-0 cursor-grab text-subtle" />
              <span className="w-5 shrink-0 text-caption tabular-nums text-subtle">{idx + 1}</span>
              <span className="min-w-0 flex-1 truncate text-body text-foreground">
                {nameOf(item.media_id)}
              </span>

              {/* Keyboard equivalent for the drag handle: drag alone fails WCAG 2.1. */}
              <span className="flex shrink-0 items-center">
                <button
                  type="button"
                  aria-label={`Move ${nameOf(item.media_id)} up`}
                  disabled={idx === 0}
                  onClick={() => move(idx, idx - 1)}
                  className="grid size-6 place-items-center rounded-control text-muted transition-colors duration-150 ease-mac hover:bg-surface-hover hover:text-foreground disabled:opacity-30"
                >
                  <Icon name="chevronRight" size={13} className="-rotate-90" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${nameOf(item.media_id)} down`}
                  disabled={idx === items.length - 1}
                  onClick={() => move(idx, idx + 1)}
                  className="grid size-6 place-items-center rounded-control text-muted transition-colors duration-150 ease-mac hover:bg-surface-hover hover:text-foreground disabled:opacity-30"
                >
                  <Icon name="chevronRight" size={13} className="rotate-90" />
                </button>
              </span>

              <input
                aria-label={`Duration in seconds for ${nameOf(item.media_id)}`}
                type="number"
                min={1}
                value={item.duration}
                onChange={(e) => setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, duration: Number(e.target.value) } : x)))}
                className="h-7 w-16 shrink-0 rounded-control border border-field-border bg-field px-2 text-body tabular-nums text-field-foreground outline-none focus:border-field-border-focus"
              />
              <button
                type="button"
                aria-label={`Remove ${nameOf(item.media_id)}`}
                onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                className="grid size-7 shrink-0 place-items-center rounded-control text-muted transition-colors duration-150 ease-mac hover:bg-danger-soft hover:text-danger"
              >
                <Icon name="close" size={14} />
              </button>
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
