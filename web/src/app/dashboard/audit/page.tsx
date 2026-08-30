"use client";

// SOT: audit-page
// WHAT:  every admin and publish action, with the actor and whether it was support.
// WHY:   the PRD requires an audit trail; impersonation must be visibly marked.
// HOW:   read-only view over the audit_logs table, filterable by action or actor.
// WHERE: writes happen in src/lib/auth.js audit()

import { useState } from "react";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { useI18n, formatDate } from "@/lib/i18n";
import {
  DataTable, EmptyState, ErrorBlock, LoadingBlock, PageHeader, SearchEmpty,
  SectionCard, StatusPill, Td, Tr,
} from "@/components/global/ui";
import { SearchField } from "@/components/global/form";

export default function AuditPage() {
  const { t } = useI18n();
  const logs = useQuery(() => api.auditLogs());
  const [query, setQuery] = useState("");

  if (logs.loading && !logs.data) return <LoadingBlock rows={8} />;
  if (logs.error) return <ErrorBlock message={logs.error} onRetry={logs.reload} />;
  const list = logs.data ?? [];

  const q = query.trim().toLowerCase();
  const filtered = q
    ? list.filter((l) =>
        [l.action, l.actor_email, l.target].some((v) => v?.toLowerCase().includes(q)))
    : list;

  return (
    <div>
      <PageHeader
        title={t("audit.title")}
        subtitle={`${list.length} recent entries`}
        actions={list.length > 0 ? (
          <SearchField
            ariaLabel={t("common.search")}
            placeholder="Action, actor or target"
            value={query}
            onChange={setQuery}
            className="w-[220px]"
          />
        ) : null}
      />

      <SectionCard flush>
        {list.length === 0 ? (
          <EmptyState
            icon="audit"
            title="No audit entries yet"
            hint="Publishes, role changes and support sessions are all recorded here."
          />
        ) : filtered.length === 0 ? (
          <SearchEmpty query={query} onClear={() => setQuery("")} />
        ) : (
          <DataTable head={["Action", "Actor", "Target", "When", ""]}>
            {filtered.map((l) => (
              <Tr key={l.id}>
                <Td><StatusPill tone="accent">{l.action}</StatusPill></Td>
                <Td>{l.actor_email ?? "system"}</Td>
                <Td className="font-mono text-caption text-muted">{l.target ?? "None"}</Td>
                <Td className="text-footnote text-muted">{formatDate(l.created_at)}</Td>
                <Td>
                  {l.impersonated ? (
                    <StatusPill tone="warning" icon="security">Support</StatusPill>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </DataTable>
        )}
      </SectionCard>
    </div>
  );
}
