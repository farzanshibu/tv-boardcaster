"use client";

// SOT: media-page, upload-flow, rendition-status, version-history
// WHAT:  the media library: upload, link CDN assets, inspect renditions and versions.
// WHY:   uploads now produce an HLS ladder, so the operator needs to see that state.
// HOW:   rendition_status reflects the background transcode queue.
// WHERE: transcode pipeline in src/lib/transcode.js

import { useRef, useState } from "react";
import { Button, Chip } from "@heroui/react";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { useI18n, timeAgo } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { permission } from "@/lib/resources";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/global/ui";
import { FormDialog } from "@/components/global/form-dialog";
import { SelectField, TextInput, FieldRow } from "@/components/global/form";
import type { MediaAsset, MediaVersion } from "@/lib/types";

const STATUS_COLOR = {
  ready: "success", processing: "accent", queued: "warning", failed: "danger", none: "default",
} as const;

export default function MediaPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const media = useQuery(() => api.media());

  const fileRef = useRef<HTMLInputElement | null>(null);
  const replaceRef = useRef<HTMLInputElement | null>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [detail, setDetail] = useState<{ asset: MediaAsset; versions: MediaVersion[] } | null>(null);

  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [duration, setDuration] = useState("10");
  const [url, setUrl] = useState("");
  const [linkType, setLinkType] = useState("image");

  if (media.loading && !media.data) return <LoadingBlock label={t("common.loading")} />;
  if (media.error) return <ErrorBlock message={media.error} onRetry={media.reload} />;
  const list = media.data ?? [];

  const openDetail = async (asset: MediaAsset) => {
    setDetail({ asset, versions: await api.mediaVersions(asset.id) });
  };

  return (
    <div>
      <PageHeader
        title={t("nav.media")}
        subtitle={`${list.length} assets`}
        actions={can(permission("media", "create")) ? (
          <>
            <Button variant="outline" onPress={() => { setUrl(""); setName(""); setLinkOpen(true); }}>{t("media.link")}</Button>
            <Button variant="primary" onPress={() => { setName(""); setTags(""); setDuration("10"); setUploadOpen(true); }}>
              {t("media.upload")}
            </Button>
          </>
        ) : null}
      />

      {list.length === 0 ? (
        <EmptyState title={t("media.empty")} hint="Upload an image or video to get started." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map((m) => {
            const poster = m.renditions && "poster_url" in m.renditions
              ? (m.renditions as { poster_url?: string }).poster_url
              : undefined;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => void openDetail(m)}
                className="panel overflow-hidden text-start transition hover:border-accent"
              >
                <div className="grid h-32 place-items-center overflow-hidden bg-background">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={poster ?? m.url} alt="" className="size-full object-cover" />
                </div>
                <div className="p-3">
                  <p className="truncate text-sm font-medium">{m.name}</p>
                  <p className="text-xs text-muted">{m.type} · {m.duration}s</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {m.status !== "approved" ? <Chip color="warning" variant="soft">pending</Chip> : null}
                    {m.rendition_status && m.rendition_status !== "none" ? (
                      <Chip color={STATUS_COLOR[m.rendition_status]} variant="soft">{m.rendition_status}</Chip>
                    ) : null}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <FormDialog
        isOpen={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Upload media"
        description="JPG, PNG, WebP, MP4, WebM or HTML5. Video is transcoded into an adaptive ladder."
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
        <label className="text-sm text-muted" htmlFor="media-file">File</label>
        <input
          id="media-file"
          ref={fileRef}
          type="file"
          accept="image/*,video/mp4,video/webm,text/html"
          className="rounded-lg border border-border bg-field p-2 text-sm"
        />
        <TextInput label="Name" value={name} onChange={setName} placeholder="Optional display name" />
        <FieldRow>
          <TextInput label="Tags (comma separated)" value={tags} onChange={setTags} placeholder="summer, offers" />
          <TextInput label="Image duration (s)" value={duration} onChange={setDuration} type="number" />
        </FieldRow>
      </FormDialog>

      <FormDialog
        isOpen={linkOpen}
        onClose={() => setLinkOpen(false)}
        title={t("media.link")}
        description="Reference media already hosted on your CDN."
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

      {detail ? (
        <FormDialog
          isOpen
          onClose={() => setDetail(null)}
          title={detail.asset.name}
          description={`${detail.asset.type} · v${detail.asset.version} · ${(detail.asset.bytes / 1e6).toFixed(1)} MB`}
          size="lg"
        >
          <div className="grid h-48 place-items-center overflow-hidden rounded-lg bg-background">
            {detail.asset.type === "video" ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video src={detail.asset.url} controls className="max-h-full max-w-full" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={detail.asset.url} alt="" className="max-h-full max-w-full object-contain" />
            )}
          </div>

          {detail.asset.renditions ? (
            <div className="rounded-lg border border-border p-3 text-sm">
              <p className="mb-2 font-medium">Adaptive renditions</p>
              <RenditionSummary renditions={detail.asset.renditions} />
            </div>
          ) : detail.asset.rendition_status === "failed" ? (
            <p className="rounded-lg border border-danger/40 bg-danger-soft p-3 text-sm">
              Transcode failed: {detail.asset.rendition_error}
            </p>
          ) : null}

          {detail.asset.status !== "approved" && can(permission("media", "approve")) ? (
            <Button size="sm" variant="secondary" onPress={() => void api.approveMedia(detail.asset.id).then(() => { media.reload(); setDetail(null); })}>
              {t("common.approve")}
            </Button>
          ) : null}

          {can(permission("media", "update")) ? (
            <div className="flex flex-col gap-2">
              <label className="text-sm text-muted" htmlFor="replace-file">Replace file (keeps version history)</label>
              <input id="replace-file" ref={replaceRef} type="file" className="rounded-lg border border-border bg-field p-2 text-sm" />
              <Button
                size="sm"
                variant="outline"
                onPress={() => {
                  const file = replaceRef.current?.files?.[0];
                  if (!file) return;
                  const form = new FormData();
                  form.append("file", file);
                  void api.replaceMedia(detail.asset.id, form).then(() => { media.reload(); setDetail(null); });
                }}
              >
                Upload replacement
              </Button>
            </div>
          ) : null}

          <div>
            <p className="mb-2 text-sm font-medium">{t("media.versions")}</p>
            <ul className="flex flex-col gap-1 text-sm">
              {detail.versions.map((v) => (
                <li key={v.id} className="flex items-center gap-3">
                  <span>v{v.version}</span>
                  <span className="text-muted">{timeAgo(v.created_at)}</span>
                  {v.version !== detail.asset.version && can(permission("media", "update")) ? (
                    <Button size="sm" variant="ghost" onPress={() => void api.restoreMedia(detail.asset.id, v.version).then(() => { media.reload(); setDetail(null); })}>
                      {t("media.restore")}
                    </Button>
                  ) : <span className="text-xs text-muted">current</span>}
                </li>
              ))}
            </ul>
          </div>
        </FormDialog>
      ) : null}
    </div>
  );
}

function RenditionSummary({ renditions }: { renditions: NonNullable<MediaAsset["renditions"]> }) {
  if ("ladder" in renditions && Array.isArray(renditions.ladder)) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap gap-1">
          {renditions.ladder.map((l) => (
            <Chip key={l.height} variant="soft" color="accent">{l.height}p @ {l.bitrate_kbps}k</Chip>
          ))}
        </div>
        <p className="text-xs text-muted">HLS master + {renditions.mp4?.length ?? 0} MP4 fallbacks</p>
      </div>
    );
  }
  if ("variants" in renditions && Array.isArray(renditions.variants)) {
    const widths = [...new Set(renditions.variants.map((v) => v.width))].sort((a, b) => a - b);
    return (
      <div className="flex flex-wrap gap-1">
        {widths.map((w) => <Chip key={w} variant="soft" color="accent">{w}px</Chip>)}
      </div>
    );
  }
  return null;
}
