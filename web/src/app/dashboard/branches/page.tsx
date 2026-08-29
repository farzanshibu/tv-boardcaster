"use client";

// SOT: branches-page, location-hierarchy
// WHAT:  locations that group screens, each with its own timezone and defaults.
// WHY:   dayparting is meaningless without the branch's local clock.
// HOW:   branch defaults apply to any screen with no explicit assignment.
// WHERE: schedule resolution in src/lib/content.js

import { useState } from "react";
import { Button, Chip } from "@heroui/react";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { permission } from "@/lib/resources";
import { DataTable, ErrorBlock, LoadingBlock, PageHeader, SectionCard, Td } from "@/components/global/ui";
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

  if (branches.loading && !branches.data) return <LoadingBlock label={t("common.loading")} />;
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
      return new Date().toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
    } catch { return "—"; }
  };

  return (
    <div>
      <PageHeader
        title={t("nav.branches")}
        subtitle={`${list.length} branches`}
        actions={can(permission("branches", "create")) ? (
          <Button variant="primary" onPress={() => openEditor(null)}>{t("branches.new")}</Button>
        ) : null}
      />

      <SectionCard>
        <DataTable head={["Branch", "Timezone", "Screens", "Local time", "Status", ""]}>
          {list.map((b) => (
            <tr key={b.id}>
              <Td>
                <p className="font-medium">{b.name}</p>
                <p className="text-xs text-muted">{b.address ?? "—"}</p>
              </Td>
              <Td className="text-muted">{b.timezone}</Td>
              <Td>{b.screen_count}</Td>
              <Td className="tabular-nums text-muted">{localTime(b.timezone)}</Td>
              <Td><Chip variant="soft" color={b.status === "active" ? "success" : "default"}>{b.status}</Chip></Td>
              <Td>
                {can(permission("branches", "update")) ? (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onPress={() => openEditor(b)}>{t("common.edit")}</Button>
                    {b.status === "active" ? (
                      <Button size="sm" variant="danger-soft" onPress={() => void api.archiveBranch(b.id).then(branches.reload)}>
                        Archive
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </Td>
            </tr>
          ))}
        </DataTable>
      </SectionCard>

      <FormDialog
        isOpen={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit branch" : "New branch"}
        description="Branch defaults apply to screens with no explicit assignment."
        confirmLabel="Save"
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
        <SelectField label="Timezone" options={TIMEZONES.map((tz) => ({ id: tz, label: tz }))} selected={timezone} onSelect={setTimezone} />
        <TextInput label="Address" value={address} onChange={setAddress} placeholder="80 Feet Road, Bengaluru" />
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
