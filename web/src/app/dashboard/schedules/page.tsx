"use client";

// SOT: schedules-page, dayparting
// WHAT:  time-boxed content rules: breakfast menus, seasonal campaigns, expiries.
// WHY:   the PRD requires dayparting with timezone awareness and clear precedence.
// HOW:   target specificity (screen > branch > org) decides conflicts; the API
//        returns overlapping schedules so the operator sees the resolution.
// WHERE: resolution logic in src/lib/content.js

import { useState } from "react";
import { Button } from "@heroui/react";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { permission } from "@/lib/resources";
import { Icon } from "@/components/global/icon";
import {
  DataTable, EmptyState, ErrorBlock, LoadingBlock, PageHeader, SectionCard,
  StatusPill, Td, Tr,
} from "@/components/global/ui";
import { FormDialog } from "@/components/global/form-dialog";
import {
  CheckboxField, SegmentedControl, SelectField, TextInput, FieldRow,
} from "@/components/global/form";
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
  const [contentType, setContentType] = useState<"playlist" | "ticker">("playlist");
  const [contentId, setContentId] = useState("");
  const [targetType, setTargetType] = useState<"org" | "branch" | "screen">("org");
  const [targetId, setTargetId] = useState("");
  const [startTime, setStartTime] = useState("07:00");
  const [endTime, setEndTime] = useState("11:00");
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [priority, setPriority] = useState("0");

  if (schedules.loading && !schedules.data) return <LoadingBlock rows={5} />;
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
    setContentType(s?.content_type === "ticker" ? "ticker" : "playlist");
    setContentId(s?.content_id ?? "");
    setTargetType(
      s?.target_type === "branch" ? "branch" : s?.target_type === "screen" ? "screen" : "org",
    );
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
          <Button variant="primary" size="sm" onPress={() => openEditor(null)}>
            <Icon name="add" size={13} />
            {t("schedules.new")}
          </Button>
        ) : null}
      />

      <SectionCard flush>
        {list.length === 0 ? (
          <EmptyState
            icon="schedules"
            title={t("schedules.empty")}
            hint='Create dayparts like "Breakfast 7 to 11am" that switch playlists automatically.'
            action={can(permission("schedules", "create")) ? (
              <Button variant="primary" size="sm" onPress={() => openEditor(null)}>
                <Icon name="add" size={13} />
                {t("schedules.new")}
              </Button>
            ) : null}
          />
        ) : (
          <DataTable head={["Schedule", "Applies to", "Window", "Days", "Priority", ""]}>
            {list.map((s) => (
              <Tr key={s.id}>
                <Td>
                  <p className="font-medium text-foreground">{s.name}</p>
                  <p className="flex items-center gap-1 text-footnote text-muted">
                    <Icon name={s.content_type === "ticker" ? "tickers" : "playlists"} size={11} />
                    {s.content_type}
                  </p>
                </Td>
                <Td>
                  <StatusPill
                    tone="neutral"
                    icon={s.target_type === "screen" ? "screens" : s.target_type === "branch" ? "branches" : "platform"}
                  >
                    {s.target_type}
                  </StatusPill>
                </Td>
                <Td className="tabular-nums">
                  {s.start_time} to {s.end_time}
                  {s.start_date ? (
                    <p className="text-footnote text-muted">
                      {s.start_date} until {s.end_date ?? "open"}
                    </p>
                  ) : null}
                </Td>
                <Td className="text-footnote text-muted">
                  {s.days_of_week.length === 7 ? "Every day" : s.days_of_week.map((d) => DAYS[d]).join(", ")}
                </Td>
                <Td className="tabular-nums">{s.priority}</Td>
                <Td>
                  {can(permission("schedules", "update")) ? (
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="outline" onPress={() => openEditor(s)}>
                        <Icon name="edit" size={13} />
                        {t("common.edit")}
                      </Button>
                      <Button size="sm" variant="danger-soft" onPress={() => void api.deleteSchedule(s.id).then(schedules.reload)}>
                        <Icon name="delete" size={13} />
                      </Button>
                    </div>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </DataTable>
        )}
      </SectionCard>

      <FormDialog
        isOpen={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit schedule" : "New schedule"}
        description="Times use each branch's local timezone. The most specific target wins conflicts."
        icon="schedules"
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

        <div className="flex flex-col gap-1.5">
          <span className="text-body font-medium text-foreground">Content type</span>
          <SegmentedControl
            ariaLabel="Content type"
            value={contentType}
            onChange={(v) => { setContentType(v); setContentId(""); }}
            options={[
              { id: "playlist", label: "Playlist", icon: "playlists" },
              { id: "ticker", label: "Flash news", icon: "tickers" },
            ]}
          />
        </div>
        <SelectField label="Content" options={contentOptions} selected={contentId} onSelect={setContentId} />

        <div className="flex flex-col gap-1.5">
          <span className="text-body font-medium text-foreground">Applies to</span>
          <SegmentedControl
            ariaLabel="Applies to"
            value={targetType}
            onChange={(v) => { setTargetType(v); setTargetId(""); }}
            options={[
              { id: "org", label: "Organization", icon: "platform" },
              { id: "branch", label: "Branch", icon: "branches" },
              { id: "screen", label: "Screen", icon: "screens" },
            ]}
          />
        </div>
        {targetType !== "org" ? (
          <SelectField label="Target" options={targetOptions} selected={targetId} onSelect={setTargetId} />
        ) : null}

        <FieldRow>
          <TextInput label="Start time" value={startTime} onChange={setStartTime} type="time" />
          <TextInput label="End time" value={endTime} onChange={setEndTime} type="time" />
        </FieldRow>

        <fieldset>
          <legend className="mb-1.5 text-body font-medium text-foreground">Days of week</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {DAYS.map((d, i) => (
              <CheckboxField
                key={d}
                label={d}
                checked={days.includes(i)}
                onChange={(checked) =>
                  setDays((prev) => (checked ? [...prev, i].sort() : prev.filter((x) => x !== i)))
                }
              />
            ))}
          </div>
        </fieldset>

        <TextInput
          label="Priority"
          value={priority}
          onChange={setPriority}
          type="number"
          description="Higher wins when two schedules target the same specificity."
        />
      </FormDialog>
    </div>
  );
}
