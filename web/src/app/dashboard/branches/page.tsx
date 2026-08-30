"use client";

// SOT: branches-page, location-hierarchy
// WHAT:  locations that group screens, each with its own timezone and defaults.
// WHY:   dayparting is meaningless without the branch's local clock, so the live
//        local time is shown per row rather than buried in an edit sheet.
// HOW:   branch defaults apply to any screen with no explicit assignment.
// WHERE: schedule resolution in src/lib/content.js

import { useEffect, useState } from "react";
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
import { SelectField, TextInput, FieldRow } from "@/components/global/form";
import type { Branch } from "@/lib/types";

const TIMEZONES = [
  "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore",
  "Europe/London", "America/New_York", "America/Los_Angeles", "UTC",
];

export default function BranchesPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const branches = useQuery(() => api.branches());
  const playlists = useQuery(() => api.playlists());
  const tickers = useQuery(() => api.tickers());

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [address, setAddress] = useState("");
  const [defaultPlaylist, setDefaultPlaylist] = useState("");
  const [defaultTicker, setDefaultTicker] = useState("");

  // Branch clocks are live: a stale time would defeat the point of showing it.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (branches.loading && !branches.data) return <LoadingBlock rows={5} />;
  if (branches.error) return <ErrorBlock message={branches.error} onRetry={branches.reload} />;
  const list = branches.data ?? [];

  const openEditor = (b: Branch | null) => {
    setEditing(b);
    setName(b?.name ?? ""); setTimezone(b?.timezone ?? "Asia/Kolkata");
    setAddress(b?.address ?? "");
    setDefaultPlaylist(b?.default_playlist_id ?? "");
    setDefaultTicker(b?.default_ticker_id ?? "");
    setOpen(true);
  };

  const localTime = (tz: string) => {
    try {
      return new Date(now).toLocaleTimeString("en-GB", {
        timeZone: tz, hour: "2-digit", minute: "2-digit",
      });
    } catch { return "Unknown"; }
  };

  return (
    <div>
      <PageHeader
        title={t("nav.branches")}
        subtitle={`${list.length} branches`}
        actions={can(permission("branches", "create")) ? (
          <Button variant="primary" size="sm" onPress={() => openEditor(null)}>
            <Icon name="add" size={13} />
            {t("branches.new")}
          </Button>
        ) : null}
      />

      <SectionCard flush>
        {list.length === 0 ? (
          <EmptyState
            icon="branches"
            title="No branches yet"
            hint="A branch groups screens and sets their local timezone for scheduling."
            action={can(permission("branches", "create")) ? (
              <Button variant="primary" size="sm" onPress={() => openEditor(null)}>
                <Icon name="add" size={13} />
                {t("branches.new")}
              </Button>
            ) : null}
          />
        ) : (
          <DataTable head={["Branch", "Timezone", "Screens", "Local time", "Status", ""]}>
            {list.map((b) => (
              <Tr key={b.id}>
                <Td>
                  <p className="font-medium text-foreground">{b.name}</p>
                  {b.address ? (
                    <p className="flex items-center gap-1 text-footnote text-muted">
                      <Icon name="location" size={11} />
                      {b.address}
                    </p>
                  ) : null}
                </Td>
                <Td className="text-footnote text-muted">{b.timezone}</Td>
                <Td className="tabular-nums">{b.screen_count}</Td>
                <Td className="tabular-nums text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <Icon name="time" size={12} />
                    {localTime(b.timezone)}
                  </span>
                </Td>
                <Td>
                  <StatusPill
                    tone={b.status === "active" ? "success" : "neutral"}
                    icon={b.status === "active" ? "success" : "info"}
                  >
                    {b.status}
                  </StatusPill>
                </Td>
                <Td>
                  {can(permission("branches", "update")) ? (
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="outline" onPress={() => openEditor(b)}>
                        <Icon name="edit" size={13} />
                        {t("common.edit")}
                      </Button>
                      {b.status === "active" ? (
                        <Button size="sm" variant="danger-soft" onPress={() => void api.archiveBranch(b.id).then(branches.reload)}>
                          Archive
                        </Button>
                      ) : null}
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
        title={editing ? "Edit branch" : "New branch"}
        description="Branch defaults apply to screens with no explicit assignment."
        icon="branches"
        confirmLabel={t("common.save")}
        onConfirm={async () => {
          if (editing) {
            await api.updateBranch(editing.id, {
              name, timezone, address,
              default_playlist_id: defaultPlaylist || null,
              default_ticker_id: defaultTicker || null,
            });
          } else {
            await api.createBranch({ name, timezone, address });
          }
          branches.reload();
        }}
      >
        <TextInput label="Branch name" value={name} onChange={setName} placeholder="Koramangala Store" />
        <SelectField
          label="Timezone"
          options={TIMEZONES.map((tz) => ({ id: tz, label: tz }))}
          selected={timezone}
          onSelect={setTimezone}
        />
        <TextInput
          label="Address"
          value={address}
          onChange={setAddress}
          placeholder="80 Feet Road, Bengaluru"
          description={`Local time here is currently ${localTime(timezone)}.`}
        />
        {editing ? (
          <FieldRow>
            <SelectField
              label="Default playlist"
              options={[{ id: "", label: "None" }, ...(playlists.data ?? []).map((p) => ({ id: p.id, label: p.name }))]}
              selected={defaultPlaylist}
              onSelect={setDefaultPlaylist}
            />
            <SelectField
              label="Default flash news"
              options={[{ id: "", label: "None" }, ...(tickers.data ?? []).map((x) => ({ id: x.id, label: x.name }))]}
              selected={defaultTicker}
              onSelect={setDefaultTicker}
            />
          </FieldRow>
        ) : null}
      </FormDialog>
    </div>
  );
}
