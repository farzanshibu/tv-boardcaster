"use client";

// SOT: superadmin-page, tenant-management, feature-flags, support-login
// WHAT:  the internal console: tenants, plans, flags, impersonation, platform health.
// WHY:   PRD s7.15 — the SaaS operator needs to support customers without DB access.
// HOW:   impersonation issues a tenant-scoped token and is written to the audit log.
// WHERE: src/routes/superadmin.js

import { useState } from "react";
import { Button, Chip } from "@heroui/react";
import { api, tokenStore } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { useI18n, formatMoney } from "@/lib/i18n";
import { DataTable, ErrorBlock, LoadingBlock, PageHeader, SectionCard, StatCard, Td } from "@/components/global/ui";
import { FormDialog } from "@/components/global/form-dialog";
import { SelectField } from "@/components/global/form";
import type { PlanKey, Tenant } from "@/lib/types";

const FLAGS = ["scheduling", "analytics", "rbac", "sso", "approval", "monitoring", "residency"];
const PLANS: PlanKey[] = ["trial", "starter", "growth", "enterprise"];

export default function AdminPage() {
  const { t, locale } = useI18n();
  const tenants = useQuery(() => api.tenants());
  const health = useQuery(() => api.platformHealth());
  const [flagTenant, setFlagTenant] = useState<Tenant | null>(null);
  const [flags, setFlags] = useState<Record<string, boolean>>({});

  if (tenants.loading && !tenants.data) return <LoadingBlock label={t("common.loading")} />;
  if (tenants.error) return <ErrorBlock message={tenants.error} onRetry={tenants.reload} />;

  const list = tenants.data ?? [];
  const h = health.data;

  const openFlags = (tenant: Tenant) => {
    setFlagTenant(tenant);
    setFlags(Object.fromEntries(FLAGS.map((f) => [f, tenant.feature_flags[f] ?? tenant.plan.features.includes(f)])));
  };

  const impersonate = async (tenant: Tenant) => {
    if (!window.confirm(`Start an audit-logged support session in ${tenant.name}?`)) return;
    const r = await api.impersonate(tenant.id, "support");
    tokenStore.set(r.token);
    window.location.href = "/dashboard";
  };

  return (
    <div>
      <PageHeader
        title={t("nav.admin")}
        subtitle="Internal platform operations"
        actions={
          <Button size="sm" variant="outline" onPress={() => void api.runJobs().then(() => { tenants.reload(); health.reload(); })}>
            Run jobs now
          </Button>
        }
      />

      {h ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Organizations" value={String(h.organizations)} />
          <StatCard label="Screens" value={String(h.screens)} hint={`${h.online_screens} online`} />
          <StatCard label="Live sessions" value={String(h.connected_sessions)} hint={`${h.publishes_24h} publishes/24h`} />
          <StatCard label="MRR" value={formatMoney(h.mrr, "INR", locale)} hint={`${h.alerts} offline alerts`} tone={h.alerts ? "warning" : "success"} />
        </div>
      ) : null}

      <SectionCard className="mt-5" title={t("admin.tenants")}>
        <DataTable head={["Organization", "Plan", "Screens", "Users", "MRR", "Status", "Actions"]}>
          {list.map((tenant) => (
            <tr key={tenant.id}>
              <Td>
                <p className="font-medium">{tenant.name}</p>
                <p className="text-xs text-muted">{tenant.country}</p>
              </Td>
              <Td>
                <SelectField
                  ariaLabel={`Plan for ${tenant.name}`}
                  options={PLANS.map((p) => ({ id: p, label: p }))}
                  selected={tenant.plan_tier}
                  onSelect={(p) => void api.setTenantPlan(tenant.id, p as PlanKey).then(tenants.reload)}
                  className="w-36"
                />
              </Td>
              <Td className="tabular-nums">{tenant.usage.screens} ({tenant.online_screens} on)</Td>
              <Td className="tabular-nums">{tenant.usage.users}</Td>
              <Td className="tabular-nums">{formatMoney(tenant.revenue_mrr, "INR", locale)}</Td>
              <Td><Chip variant="soft" color={tenant.status === "active" ? "success" : "danger"}>{tenant.status}</Chip></Td>
              <Td>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onPress={() => openFlags(tenant)}>Flags</Button>
                  <Button size="sm" variant="secondary" onPress={() => void impersonate(tenant)}>{t("admin.support_login")}</Button>
                  <Button size="sm" variant="danger-soft" onPress={() => void api.suspendTenant(tenant.id).then(tenants.reload)}>
                    {tenant.status === "active" ? "Suspend" : "Restore"}
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
        </DataTable>
      </SectionCard>

      {h ? (
        <SectionCard className="mt-5" title={t("admin.health")}>
          <div className="flex flex-wrap gap-2">
            <Chip variant="soft" color="success">uptime {Math.round(h.uptime_seconds / 60)}m</Chip>
            <Chip variant="soft">memory {h.memory_mb} MB</Chip>
            {h.plan_distribution.map((p) => (
              <Chip key={p.plan_tier} variant="soft" color="accent">{p.plan_tier}: {p.c}</Chip>
            ))}
          </div>
        </SectionCard>
      ) : null}

      {flagTenant ? (
        <FormDialog
          isOpen
          onClose={() => setFlagTenant(null)}
          title={`Feature flags — ${flagTenant.name}`}
          description="Overrides plan defaults for staged rollout."
          confirmLabel="Apply flags"
          onConfirm={async () => {
            await api.setTenantFlags(flagTenant.id, flags);
            tenants.reload();
          }}
        >
          {FLAGS.map((f) => (
            <label key={f} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={flags[f] ?? false}
                onChange={(e) => setFlags((prev) => ({ ...prev, [f]: e.target.checked }))}
              />
              {f}
            </label>
          ))}
        </FormDialog>
      ) : null}
    </div>
  );
}
