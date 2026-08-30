"use client";

// SOT: tickers-page, flash-news
// WHAT:  scrolling ticker messages overlaid on the playlist.
// WHY:   store hours and compliance notices change independently of the loop.
// HOW:   optional start/end times let a ticker run only during trading hours.
//        Each card previews the real colours, so the operator sees the result.
// WHERE: rendering happens in web/src/app/tv/page.tsx

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
import {
  SegmentedControl, TextInput, TextAreaInput, FieldRow,
} from "@/components/global/form";
import type { Ticker } from "@/lib/types";

export default function TickersPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const tickers = useQuery(() => api.tickers());

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Ticker | null>(null);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [position, setPosition] = useState<"bottom" | "top">("bottom");
  const [speed, setSpeed] = useState("60");
  const [color, setColor] = useState("#ffffff");
  const [background, setBackground] = useState("#0f172a");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  if (tickers.loading && !tickers.data) return <SkeletonGrid count={4} />;
  if (tickers.error) return <ErrorBlock message={tickers.error} onRetry={tickers.reload} />;
  const list = tickers.data ?? [];

  const openEditor = (x: Ticker | null) => {
    setEditing(x);
    setName(x?.name ?? ""); setText(x?.text ?? "");
    setPosition(x?.position === "top" ? "top" : "bottom");
    setSpeed(String(x?.speed ?? 60));
    setColor(x?.color ?? "#ffffff"); setBackground(x?.background ?? "#0f172a");
    setStartTime(x?.start_time ?? ""); setEndTime(x?.end_time ?? "");
    setOpen(true);
  };

  return (
    <div>
      <PageHeader
        title={t("nav.tickers")}
        subtitle={`${list.length} tickers`}
        actions={can(permission("tickers", "create")) ? (
          <Button variant="primary" size="sm" onPress={() => openEditor(null)}>
            <Icon name="add" size={13} />
            {t("tickers.new")}
          </Button>
        ) : null}
      />

      {list.length === 0 ? (
        <SectionCard flush>
          <EmptyState
            icon="tickers"
            title={t("tickers.empty")}
            hint="A ticker scrolls over your playlist. Use it for store hours or notices."
            action={can(permission("tickers", "create")) ? (
              <Button variant="primary" size="sm" onPress={() => openEditor(null)}>
                <Icon name="add" size={13} />
                {t("tickers.new")}
              </Button>
            ) : null}
          />
        </SectionCard>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map((x) => (
            <div key={x.id} className="group-panel flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-callout font-semibold text-foreground">{x.name}</p>
                <StatusPill tone="neutral" icon={x.start_time ? "time" : "check"}>
                  {x.start_time ? `${x.start_time} to ${x.end_time}` : "Always on"}
                </StatusPill>
              </div>

              {/* Live preview in the ticker's own colours: the operator sees the result. */}
              <div
                className="overflow-hidden rounded-control border border-border"
                style={{ background: x.background, color: x.color }}
              >
                <p className="truncate px-3 py-2 text-body">{x.text}</p>
              </div>

              <p className="flex items-center gap-1.5 text-footnote text-muted">
                <Icon name="expand" size={12} />
                {x.position} · speed {x.speed}
              </p>

              <div className="flex gap-2 border-t border-separator pt-3">
                {can(permission("tickers", "update")) ? (
                  <Button size="sm" variant="outline" onPress={() => openEditor(x)}>
                    <Icon name="edit" size={13} />
                    {t("common.edit")}
                  </Button>
                ) : null}
                {can(permission("tickers", "delete")) ? (
                  <Button size="sm" variant="danger-soft" className="ms-auto" onPress={() => void api.deleteTicker(x.id).then(tickers.reload)}>
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
        title={editing ? "Edit flash news" : "New flash news"}
        description="A scrolling ticker shown over the playlist."
        icon="tickers"
        confirmLabel={t("common.save")}
        onConfirm={async () => {
          const body = {
            name, text, position, speed: Number(speed), color, background,
            start_time: startTime || null, end_time: endTime || null,
          };
          if (editing) await api.updateTicker(editing.id, body);
          else await api.createTicker(body);
          tickers.reload();
        }}
      >
        <TextInput label="Name" value={name} onChange={setName} placeholder="Store hours notice" />
        <TextAreaInput label="Message" value={text} onChange={setText} placeholder="Welcome · Open 9am to 10pm" />

        {/* Preview inside the sheet too, so colour choices are checked before saving. */}
        <div
          className="overflow-hidden rounded-field border border-border"
          style={{ background, color }}
        >
          <p className="truncate px-3 py-2 text-body">{text || "Preview"}</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-body font-medium text-foreground">Position</span>
          <SegmentedControl
            ariaLabel="Ticker position"
            value={position}
            onChange={setPosition}
            options={[{ id: "bottom", label: "Bottom" }, { id: "top", label: "Top" }]}
          />
        </div>

        <FieldRow>
          <TextInput label="Text colour" value={color} onChange={setColor} type="color" />
          <TextInput label="Background" value={background} onChange={setBackground} type="color" />
        </FieldRow>
        <FieldRow>
          <TextInput label="Scroll speed" value={speed} onChange={setSpeed} type="number" />
          <TextInput label="Show from (local)" value={startTime} onChange={setStartTime} type="time" />
        </FieldRow>
        <TextInput label="Show until (local)" value={endTime} onChange={setEndTime} type="time" />
      </FormDialog>
    </div>
  );
}
