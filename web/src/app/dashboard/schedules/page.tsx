"use client";

// SOT: schedules-page, dayparting
// WHAT:  time-boxed content rules: breakfast menus, seasonal campaigns, expiries.
// WHY:   the PRD requires dayparting with timezone awareness and clear precedence.
// HOW:   target specificity (screen > branch > org) decides conflicts; the API
//        returns overlapping schedules so the operator sees the resolution.
// WHERE: resolution logic in src/lib/content.js

import { useState } from "react";
import { Button, Chip } from "@heroui/react";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { permission } from "@/lib/resources";
import { DataTable, EmptyState, ErrorBlock, LoadingBlock, PageHeader, SectionCard, Td } from "@/components/global/ui";
import { FormDialog } from "@/components/global/form-dialog";
import { SelectField, TextInput, FieldRow } from "@/components/global/form";
import type { Schedule } from "@/lib/types";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function SchedulesPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const schedules = useQuery(() => api.schedules());
  const playlists = useQuery(() => api.playlists());
  const tickers = useQuery(() => api.tickers());
  const branches = useQuery(() => api.branches());
  const screens = useQuery(() => api.screens());

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [name, setName] = useState("");
  const [contentType, setContentType] = useState("playlist");
  const [contentId, setContentId] = useState("");
  const [targetType, setTargetType] = useState("org");
  const [targetId, setTargetId] = useState("");
  const [startTime, setStartTime] = useState("07:00");
  const [endTime, setEndTime] = useState("11:00");
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [priority, setPriority] = useState("0");

  if (schedules.loading && !schedules.data) return <LoadingBlock label={t("common.loading")} />;
  if (schedules.error) return <ErrorBlock message={schedules.error} onRetry={schedules.reload} />;
  const list = schedules.data ?? [];

  const contentOptions = (contentType === "ticker" ? tickers.data ?? [] : playlists.data ?? [])
    .map((c) => ({ id: c.id, label: c.name }));
  const targetOptions = targetType === "branch"
    ? (branches.data ?? []).map((b) => ({ id: b.id, label: b.name }))
    : targetType === "screen"
      ? (screens.data ?? []).map((s) => ({ id: s.id, label: s.name }))
      : [];

  const openEditor = (s: Schedule | null) => {
    setEditing(s);
    setName(s?.name ?? "");
    setContentType(s?.content_type ?? "playlist");
    setContentId(s?.content_id ?? "");
    setTargetType(s?.target_type ?? "org");
    setTargetId(s?.target_id ?? "");
    setStartTime(s?.start_time ?? "07:00");
    setEndTime(s?.end_time ?? "11:00");
    setDays(s?.days_of_week ?? [0, 1, 2, 3, 4, 5, 6]);
    setPriority(String(s?.priority ?? 0));
    setOpen(true);
  };

  return (
    <div>
      <PageHeader
        title={t("nav.schedules")}
        subtitle={`${list.length} schedules`}
        actions={can(permission("schedules", "create")) ? (
          <Button variant="primary" onPress={() => openEditor(null)}>{t("schedules.new")}</Button>
        ) : null}
      />

      {list.length === 0 ? (
        <EmptyState title={t("schedules.empty")} hint='Create dayparts like "Breakfast 7-11am" that switch playlists automatically.' />
      ) : (
        <SectionCard>
          <DataTable head={["Schedule", "Applies to", "Window", "Days", "Priority", ""]}>
            {list.map((s) => (
              <tr key={s.id}>
                <Td>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-xs text-muted">{s.content_type}</p>
                </Td>
                <Td><Chip variant="soft">{s.target_type}</Chip></Td>
                <Td className="tabular-nums">
                  {s.start_time} – {s.end_time}
                  {s.start_date ? <p className="text-xs text-muted">{s.start_date} → {s.end_date ?? "open"}</p> : null}
                </Td>
                <Td className="text-xs text-muted">
                  {s.days_of_week.length === 7 ? "Every day" : s.days_of_week.map((d) => DAYS[d]).join(", ")}
                </Td>
                <Td>{s.priority}</Td>
                <Td>
                  {can(permission("schedules", "update")) ? (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onPress={() => openEditor(s)}>{t("common.edit")}</Button>
                      <Button size="sm" variant="danger-soft" onPress={() => void api.deleteSchedule(s.id).then(schedules.reload)}>
                        {t("common.delete")}
                      </Button>
                    </div>
                  ) : null}
                </Td>
              </tr>
            ))}
          </DataTable>
        </SectionCard>
      )}

      <FormDialog
        isOpen={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit schedule" : "New schedule"}
        description="Times use each branch's local timezone. The most specific target wins conflicts."
        size="lg"
        confirmLabel="Save schedule"
        onConfirm={async () => {
          const body = {
            name, content_type: contentType, content_id: contentId,
            target_type: targetType, target_id: targetType === "org" ? null : targetId,
            start_time: startTime, end_time: endTime,
            days_of_week: days, priority: Number(priority) || 0,
          };
          if (editing) await api.updateSchedule(editing.id, body);
          else await api.createSchedule(body);
          schedules.reload();
        }}
      >
        <TextInput label="Schedule name" value={name} onChange={setName} placeholder="Breakfast menu" />
        <FieldRow>
          <SelectField
            label="Content type"
            options={[{ id: "playlist", label: "Playlist" }, { id: "ticker", label: "Flash news" }]}
            selected={contentType}
            onSelect={(v) => { setContentType(v); setContentId(""); }}
          />
          <SelectField label="Content" options={contentOptions} selected={contentId} onSelect={setContentId} />
        </FieldRow>
        <FieldRow>
          <SelectField
            label="Applies to"
            options={[
              { id: "org", label: "Whole organization" },
              { id: "branch", label: "Branch" },
              { id: "screen", label: "Single screen" },
            ]}
            selected={targetType}
            onSelect={(v) => { setTargetType(v); setTargetId(""); }}
          />
          <SelectField
            label="Target"
            options={targetOptions}
            selected={targetId}
            onSelect={setTargetId}
            isDisabled={targetType === "org"}
          />
        </FieldRow>
        <FieldRow>
          <TextInput label="Start time" value={startTime} onChange={setStartTime} type="time" />
          <TextInput label="End time" value={endTime} onChange={setEndTime} type="time" />
        </FieldRow>
        <fieldset>
          <legend className="mb-1 text-sm text-muted">Days of week</legend>
          <div className="flex flex-wrap gap-3">
            {DAYS.map((d, i) => (
              <label key={d} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={days.includes(i)}
                  onChange={(e) => setDays((prev) => (e.target.checked ? [...prev, i].sort() : prev.filter((x) => x !== i)))}
                />
                {d}
              </label>
            ))}
          </div>
        </fieldset>
        <TextInput label="Priority (higher wins ties)" value={priority} onChange={setPriority} type="number" />
      </FormDialog>
    </div>
  );
}
