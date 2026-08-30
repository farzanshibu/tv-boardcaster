"use client";

// SOT: media-page, upload-flow, rendition-status, version-history
// WHAT:  the media library: upload, link CDN assets, inspect renditions and versions.
// WHY:   uploads now produce an HLS ladder, so the operator needs to see that state.
// HOW:   rendition_status reflects the background transcode queue and is shown as a
//        labelled pill, never colour alone.
// WHERE: transcode pipeline in src/lib/transcode.js

import { useRef, useState } from "react";
import { Button } from "@heroui/react";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { useI18n, timeAgo } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { permission } from "@/lib/resources";
import { Icon, type IconName } from "@/components/global/icon";
import {
  DetailRow, EmptyState, ErrorBlock, InlineNotice, PageHeader, SearchEmpty,
  SectionCard, SkeletonGrid, StatusPill,
} from "@/components/global/ui";
import { FormDialog } from "@/components/global/form-dialog";
import { FileField, SearchField, SelectField, TextInput, FieldRow } from "@/components/global/form";
import type { MediaAsset, MediaVersion } from "@/lib/types";

/** Transcode state: a tone and an icon, so the pill never relies on colour alone. */
const RENDITION: Record<string, { tone: "success" | "accent" | "warning" | "danger"; icon: IconName }> = {
  ready: { tone: "success", icon: "success" },
  processing: { tone: "accent", icon: "pending" },
  queued: { tone: "warning", icon: "time" },
  failed: { tone: "danger", icon: "error" },
};

export default function MediaPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const media = useQuery(() => api.media());

  const fileRef = useRef<HTMLInputElement | null>(null);
  const replaceRef = useRef<HTMLInputElement | null>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [detail, setDetail] = useState<{ asset: MediaAsset; versions: MediaVersion[] } | null>(null);
  const [query, setQuery] = useState("");

  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [duration, setDuration] = useState("10");
  const [url, setUrl] = useState("");
  const [linkType, setLinkType] = useState("image");

  if (media.loading && !media.data) return <SkeletonGrid count={8} />;
  if (media.error) return <ErrorBlock message={media.error} onRetry={media.reload} />;
  const list = media.data ?? [];

  const q = query.trim().toLowerCase();
  const filtered = q
    ? list.filter((m) => m.name.toLowerCase().includes(q) || m.type.toLowerCase().includes(q))
    : list;

  const openDetail = async (asset: MediaAsset) => {
    setDetail({ asset, versions: await api.mediaVersions(asset.id) });
  };

  return (
    <div>
      <PageHeader
        title={t("nav.media")}
        subtitle={`${list.length} assets`}
        actions={
          <>
            {list.length > 0 ? (
              <SearchField
                ariaLabel={t("common.search")}
                placeholder={t("common.search")}
                value={query}
                onChange={setQuery}
                className="w-[180px]"
              />
            ) : null}
            {can(permission("media", "create")) ? (
              <>
                <Button variant="outline" size="sm" onPress={() => { setUrl(""); setName(""); setLinkOpen(true); }}>
                  <Icon name="link" size={13} />
                  {t("media.link")}
                </Button>
                <Button variant="primary" size="sm" onPress={() => { setName(""); setTags(""); setDuration("10"); setUploadOpen(true); }}>
                  <Icon name="upload" size={13} />
                  {t("media.upload")}
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {list.length === 0 ? (
        <SectionCard flush>
          <EmptyState
            icon="media"
            title={t("media.empty")}
            hint="Upload an image or video, or link one already hosted on your CDN."
            action={can(permission("media", "create")) ? (
              <Button variant="primary" size="sm" onPress={() => setUploadOpen(true)}>
                <Icon name="upload" size={13} />
                {t("media.upload")}
              </Button>
            ) : null}
          />
        </SectionCard>
      ) : filtered.length === 0 ? (
        <SectionCard flush>
          <SearchEmpty query={query} onClear={() => setQuery("")} />
        </SectionCard>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((m) => {
            const poster = m.renditions && "poster_url" in m.renditions
              ? (m.renditions as { poster_url?: string }).poster_url
              : undefined;
            const rendition = m.rendition_status && m.rendition_status !== "none"
              ? RENDITION[m.rendition_status]
              : undefined;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => void openDetail(m)}
                className="group-panel text-start transition-colors duration-150 ease-mac hover:bg-surface-hover"
              >
                <div className="relative grid h-32 place-items-center overflow-hidden bg-background-tertiary">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={poster ?? m.url} alt="" className="size-full object-cover" />
                  {m.type === "video" ? (
                    <span className="absolute bottom-2 end-2 grid size-6 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm">
                      <Icon name="video" size={12} />
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-col gap-1.5 p-3">
                  <p className="truncate text-body font-medium text-foreground">{m.name}</p>
                  <p className="text-footnote text-muted">{m.type} · {m.duration}s</p>
                  {m.status !== "approved" || rendition ? (
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {m.status !== "approved" ? (
                        <StatusPill tone="warning" icon="time">Pending approval</StatusPill>
                      ) : null}
                      {rendition ? (
                        <StatusPill tone={rendition.tone} icon={rendition.icon}>
                          {m.rendition_status}
                        </StatusPill>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ---- Upload ---- */}
      <FormDialog
        isOpen={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Upload media"
        description="JPG, PNG, WebP, MP4, WebM or HTML5."
        icon="upload"
        confirmLabel="Upload"
        onConfirm={async () => {
          const file = fileRef.current?.files?.[0];
          if (!file) throw new Error("Choose a file first");
          const form = new FormData();
          form.append("file", file);
          if (name) form.append("name", name);
          form.append("duration", duration || "10");
          form.append("tags", JSON.stringify(tags.split(",").map((x) => x.trim()).filter(Boolean)));
          await api.uploadMedia(form);
          media.reload();
        }}
      >
        <FileField
          id="media-file"
          label="File"
          accept="image/*,video/mp4,video/webm,text/html"
          inputRef={fileRef}
          hint="Video is transcoded into an adaptive ladder in the background."
        />
        <TextInput label="Name" value={name} onChange={setName} placeholder="Optional display name" />
        <FieldRow>
          <TextInput label="Tags" value={tags} onChange={setTags} placeholder="summer, offers" description="Comma separated" />
          <TextInput label="Image duration (s)" value={duration} onChange={setDuration} type="number" />
        </FieldRow>
      </FormDialog>

      {/* ---- Link CDN asset ---- */}
      <FormDialog
        isOpen={linkOpen}
        onClose={() => setLinkOpen(false)}
        title={t("media.link")}
        description="Reference media already hosted on your CDN."
        icon="link"
        confirmLabel="Add"
        onConfirm={async () => {
          await api.linkMedia({ name, url, type: linkType, duration: Number(duration) || 10 });
          media.reload();
        }}
      >
        <TextInput label="Name" value={name} onChange={setName} placeholder="Diwali banner" />
        <TextInput label="URL" value={url} onChange={setUrl} placeholder="https://cdn.example.com/banner.jpg" />
        <FieldRow>
          <SelectField
            label="Type"
            options={[{ id: "image", label: "Image" }, { id: "video", label: "Video" }, { id: "html", label: "HTML5" }]}
            selected={linkType}
            onSelect={setLinkType}
          />
          <TextInput label="Duration (s)" value={duration} onChange={setDuration} type="number" />
        </FieldRow>
      </FormDialog>

      {/* ---- Asset detail ---- */}
      {detail ? (
        <FormDialog
          isOpen
          onClose={() => setDetail(null)}
          title={detail.asset.name}
          description={`${detail.asset.type} · version ${detail.asset.version}`}
          icon="media"
          size="lg"
          cancelLabel={t("common.close")}
        >
          <div className="grid h-48 place-items-center overflow-hidden rounded-group border border-border bg-background-tertiary">
            {detail.asset.type === "video" ? (
              <video src={detail.asset.url} controls className="max-h-full max-w-full" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={detail.asset.url} alt="" className="max-h-full max-w-full object-contain" />
            )}
          </div>

          <div className="group-panel px-4 py-1">
            <DetailRow label="Type">{detail.asset.type}</DetailRow>
            <DetailRow label="Size">{(detail.asset.bytes / 1e6).toFixed(1)} MB</DetailRow>
            <DetailRow label="Duration">{detail.asset.duration}s</DetailRow>
            <DetailRow label="Version">v{detail.asset.version}</DetailRow>
          </div>

          {detail.asset.renditions ? (
            <SectionCard title="Adaptive renditions">
              <RenditionSummary renditions={detail.asset.renditions} />
            </SectionCard>
          ) : detail.asset.rendition_status === "failed" ? (
            <InlineNotice icon="error" tone="danger">
              Transcode failed: {detail.asset.rendition_error}
            </InlineNotice>
          ) : null}

          {detail.asset.status !== "approved" && can(permission("media", "approve")) ? (
            <Button size="sm" variant="secondary" onPress={() => void api.approveMedia(detail.asset.id).then(() => { media.reload(); setDetail(null); })}>
              <Icon name="approved" size={13} />
              {t("common.approve")}
            </Button>
          ) : null}

          {can(permission("media", "update")) ? (
            <div className="flex flex-col gap-2">
              <FileField
                id="replace-file"
                label="Replace file"
                inputRef={replaceRef}
                hint="The current version is kept in history."
              />
              <Button
                size="sm"
                variant="outline"
                className="self-start"
                onPress={() => {
                  const file = replaceRef.current?.files?.[0];
                  if (!file) return;
                  const form = new FormData();
                  form.append("file", file);
                  void api.replaceMedia(detail.asset.id, form).then(() => { media.reload(); setDetail(null); });
                }}
              >
                <Icon name="upload" size={13} />
                Upload replacement
              </Button>
            </div>
          ) : null}

          <SectionCard flush title={t("media.versions")}>
            <ul className="divide-y divide-separator">
              {detail.versions.map((v) => (
                <li key={v.id} className="flex items-center gap-3 px-4 py-2">
                  <span className="text-body font-medium tabular-nums text-foreground">v{v.version}</span>
                  <span className="text-footnote text-muted">{timeAgo(v.created_at)}</span>
                  {v.version !== detail.asset.version && can(permission("media", "update")) ? (
                    <Button className="ms-auto" size="sm" variant="ghost" onPress={() => void api.restoreMedia(detail.asset.id, v.version).then(() => { media.reload(); setDetail(null); })}>
                      <Icon name="rollback" size={13} />
                      {t("media.restore")}
                    </Button>
                  ) : (
                    <StatusPill tone="accent" icon="check">Current</StatusPill>
                  )}
                </li>
              ))}
            </ul>
          </SectionCard>
        </FormDialog>
      ) : null}
    </div>
  );
}

function RenditionSummary({ renditions }: { renditions: NonNullable<MediaAsset["renditions"]> }) {
  if ("ladder" in renditions && Array.isArray(renditions.ladder)) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1">
          {renditions.ladder.map((l) => (
            <StatusPill key={l.height} tone="accent" icon="layers">
              {l.height}p at {l.bitrate_kbps}k
            </StatusPill>
          ))}
        </div>
        <p className="text-footnote text-muted">
          HLS master plus {renditions.mp4?.length ?? 0} MP4 fallbacks
        </p>
      </div>
    );
  }
  if ("variants" in renditions && Array.isArray(renditions.variants)) {
    const widths = [...new Set(renditions.variants.map((v) => v.width))].sort((a, b) => a - b);
    return (
      <div className="flex flex-wrap gap-1">
        {widths.map((w) => (
          <StatusPill key={w} tone="accent" icon="media">{w}px</StatusPill>
        ))}
      </div>
    );
  }
  return null;
}
