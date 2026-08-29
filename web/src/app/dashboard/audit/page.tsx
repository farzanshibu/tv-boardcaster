"use client";

// SOT: audit-page
// WHAT:  every admin and publish action, with the actor and whether it was support.
// WHY:   the PRD requires an audit trail; impersonation must be visibly marked.
// HOW:   read-only view over the audit_logs table.
// WHERE: writes happen in src/lib/auth.js audit()

import { Chip } from "@heroui/react";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { useI18n, formatDate } from "@/lib/i18n";
import { DataTable, EmptyState, ErrorBlock, LoadingBlock, PageHeader, SectionCard, Td } from "@/components/global/ui";

export default function AuditPage() {
  const { t } = useI18n();
  const logs = useQuery(() => api.auditLogs());

  if (logs.loading && !logs.data) return <LoadingBlock label={t("common.loading")} />;
  if (logs.error) return <ErrorBlock message={logs.error} onRetry={logs.reload} />;
  const list = logs.data ?? [];

  return (
    <div>
      <PageHeader title={t("audit.title")} subtitle={`${list.length} recent entries`} />
      <SectionCard>
        {list.length === 0 ? (
          <EmptyState title="No audit entries yet." />
        ) : (
          <DataTable head={["Action", "Actor", "Target", "When", ""]}>
            {list.map((l) => (
              <tr key={l.id}>
                <Td><Chip variant="soft" color="accent">{l.action}</Chip></Td>
                <Td>{l.actor_email ?? "system"}</Td>
                <Td className="text-xs text-muted">{l.target ?? "—"}</Td>
                <Td className="text-muted">{formatDate(l.created_at)}</Td>
                <Td>{l.impersonated ? <Chip color="warning" variant="soft">support</Chip> : null}</Td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>
    </div>
  );
}
