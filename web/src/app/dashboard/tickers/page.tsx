"use client";

// SOT: tickers-page, flash-news
// WHAT:  scrolling ticker messages overlaid on the playlist.
// WHY:   store hours and compliance notices change independently of the loop.
// HOW:   optional start/end times let a ticker run only during trading hours.
// WHERE: rendering happens in web/src/app/tv/page.tsx

import { useState } from "react";
import { Button } from "@heroui/react";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { permission } from "@/lib/resources";
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/global/ui";
import { FormDialog } from "@/components/global/form-dialog";
import { SelectField, TextInput, TextAreaInput, FieldRow } from "@/components/global/form";
import type { Ticker } from "@/lib/types";

export default function TickersPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const tickers = useQuery(() => api.tickers());

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Ticker | null>(null);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [position, setPosition] = useState("bottom");
  const [speed, setSpeed] = useState("60");
  const [color, setColor] = useState("#ffffff");
  const [background, setBackground] = useState("#0f172a");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  if (tickers.loading && !tickers.data) return <LoadingBlock label={t("common.loading")} />;
  if (tickers.error) return <ErrorBlock message={tickers.error} onRetry={tickers.reload} />;
  const list = tickers.data ?? [];

  const openEditor = (x: Ticker | null) => {
    setEditing(x);
    setName(x?.name ?? ""); setText(x?.text ?? "");
    setPosition(x?.position ?? "bottom"); setSpeed(String(x?.speed ?? 60));
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
          <Button variant="primary" onPress={() => openEditor(null)}>{t("tickers.new")}</Button>
        ) : null}
      />

      {list.length === 0 ? (
        <EmptyState title={t("tickers.empty")} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map((x) => (
            <div key={x.id} className="panel p-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold">{x.name}</p>
                <span className="text-xs text-muted">{x.position}</span>
              </div>
              <p
                className="mt-3 truncate rounded-md px-3 py-2 text-sm"
                style={{ background: x.background, color: x.color }}
              >
                {x.text}
              </p>
              <p className="mt-2 text-xs text-muted">
                {x.start_time ? `Active ${x.start_time}–${x.end_time}` : "Always on"}
              </p>
              <div className="mt-3 flex gap-2">
                {can(permission("tickers", "update")) ? (
                  <Button size="sm" variant="outline" onPress={() => openEditor(x)}>{t("common.edit")}</Button>
                ) : null}
                {can(permission("tickers", "delete")) ? (
                  <Button size="sm" variant="danger-soft" onPress={() => void api.deleteTicker(x.id).then(tickers.reload)}>
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
        description="Scrolling ticker shown over the playlist."
        confirmLabel="Save"
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
        <TextAreaInput label="Message" value={text} onChange={setText} placeholder="Welcome • Open 9am-10pm" />
        <FieldRow>
          <SelectField
            label="Position"
            options={[{ id: "bottom", label: "Bottom" }, { id: "top", label: "Top" }]}
            selected={position}
            onSelect={setPosition}
          />
          <TextInput label="Scroll speed" value={speed} onChange={setSpeed} type="number" />
        </FieldRow>
        <FieldRow>
          <TextInput label="Text colour" value={color} onChange={setColor} type="color" />
          <TextInput label="Background" value={background} onChange={setBackground} type="color" />
        </FieldRow>
        <FieldRow>
          <TextInput label="Show from (local)" value={startTime} onChange={setStartTime} type="time" />
          <TextInput label="Show until (local)" value={endTime} onChange={setEndTime} type="time" />
        </FieldRow>
      </FormDialog>
    </div>
  );
}
