"use client";

// SOT: superadmin-page, tenant-management, feature-flags, support-login
// WHAT:  the internal console: tenants, plans, flags, impersonation, platform health.
// WHY:   PRD s7.15, the SaaS operator needs to support customers without DB access.
// HOW:   impersonation issues a tenant-scoped token and is written to the audit log,
//        so it is gated behind an explicit confirmation sheet rather than window.confirm.
// WHERE: src/routes/superadmin.js

import { useState } from "react";
import { Button } from "@heroui/react";
import { api, tokenStore } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { useI18n, formatMoney } from "@/lib/i18n";
import { Icon } from "@/components/global/icon";
import {
  DataTable, DetailRow, ErrorBlock, LoadingBlock, PageHeader, SectionCard,
  StatCard, StatusPill, Td, Tr,
} from "@/components/global/ui";
import { FormDialog } from "@/components/global/form-dialog";
import { CheckboxField, SelectField } from "@/components/global/form";
import type { PlanKey, Tenant } from "@/lib/types";

const FLAGS = ["scheduling", "analytics", "rbac", "sso", "approval", "monitoring", "residency"];
const PLANS: PlanKey[] = ["trial", "starter", "growth", "enterprise"];

export default function AdminPage() {
  const { t, locale } = useI18n();
  const tenants = useQuery(() => api.tenants());
  const health = useQuery(() => api.platformHealth());
  const [flagTenant, setFlagTenant] = useState<Tenant | null>(null);
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [supportTarget, setSupportTarget] = useState<Tenant | null>(null);

  if (tenants.loading && !tenants.data) return <LoadingBlock rows={6} />;
  if (tenants.error) return <ErrorBlock message={tenants.error} onRetry={tenants.reload} />;

  const list = tenants.data ?? [];
  const h = health.data;

  const openFlags = (tenant: Tenant) => {
    setFlagTenant(tenant);
    setFlags(Object.fromEntries(FLAGS.map((f) => [f, tenant.feature_flags[f] ?? tenant.plan.features.includes(f)])));
  };

  return (
    <div>
      <PageHeader
        title={t("nav.admin")}
        subtitle="Internal platform operations"
        actions={
          <Button size="sm" variant="outline" onPress={() => void api.runJobs().then(() => { tenants.reload(); health.reload(); })}>
            <Icon name="refresh" size={13} />
            Run jobs now
          </Button>
        }
      />

      {h ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon="branches" label="Organizations" value={String(h.organizations)} />
          <StatCard icon="screens" label="Screens" value={String(h.screens)} hint={`${h.online_screens} online`} />
          <StatCard icon="online" label="Live sessions" value={String(h.connected_sessions)} hint={`${h.publishes_24h} publishes/24h`} />
          <StatCard
            icon="money"
            label="MRR"
            value={formatMoney(h.mrr, "INR", locale)}
            hint={`${h.alerts} offline alerts`}
            tone={h.alerts ? "warning" : "success"}
          />
        </div>
      ) : null}

      <SectionCard flush className="mt-5" title={t("admin.tenants")}>
        <DataTable head={["Organization", "Plan", "Screens", "Users", "MRR", "Status", "Actions"]}>
          {list.map((tenant) => (
            <Tr key={tenant.id}>
              <Td>
                <p className="font-medium text-foreground">{tenant.name}</p>
                <p className="text-footnote text-muted">{tenant.country}</p>
              </Td>
              <Td>
                <SelectField
                  ariaLabel={`Plan for ${tenant.name}`}
                  options={PLANS.map((p) => ({ id: p, label: p }))}
                  selected={tenant.plan_tier}
                  onSelect={(p) => void api.setTenantPlan(tenant.id, p as PlanKey).then(tenants.reload)}
                  className="w-[136px]"
                />
              </Td>
              <Td className="tabular-nums">
                {tenant.usage.screens}
                <span className="text-footnote text-muted"> ({tenant.online_screens} on)</span>
              </Td>
              <Td className="tabular-nums">{tenant.usage.users}</Td>
              <Td className="tabular-nums">{formatMoney(tenant.revenue_mrr, "INR", locale)}</Td>
              <Td>
                <StatusPill
                  tone={tenant.status === "active" ? "success" : "danger"}
                  icon={tenant.status === "active" ? "success" : "error"}
                >
                  {tenant.status}
                </StatusPill>
              </Td>
              <Td>
                <div className="flex flex-wrap justify-end gap-1.5">
                  <Button size="sm" variant="outline" onPress={() => openFlags(tenant)}>
                    <Icon name="settings" size={13} />
                    Flags
                  </Button>
                  <Button size="sm" variant="secondary" onPress={() => setSupportTarget(tenant)}>
                    <Icon name="security" size={13} />
                    {t("admin.support_login")}
                  </Button>
                  <Button size="sm" variant="danger-soft" onPress={() => void api.suspendTenant(tenant.id).then(tenants.reload)}>
                    {tenant.status === "active" ? "Suspend" : "Restore"}
                  </Button>
                </div>
              </Td>
            </Tr>
          ))}
        </DataTable>
      </SectionCard>

      {h ? (
        <SectionCard className="mt-5" title={t("admin.health")}>
          <div className="flex flex-wrap gap-1.5">
            <StatusPill tone="success" icon="success">
              Uptime {Math.round(h.uptime_seconds / 60)}m
            </StatusPill>
            <StatusPill tone="neutral" icon="layers">Memory {h.memory_mb} MB</StatusPill>
            {h.plan_distribution.map((p) => (
              <StatusPill key={p.plan_tier} tone="accent" icon="billing">
                {p.plan_tier}: {p.c}
              </StatusPill>
            ))}
          </div>
        </SectionCard>
      ) : null}

      {/* ---- Feature flags ---- */}
      {flagTenant ? (
        <FormDialog
          isOpen
          onClose={() => setFlagTenant(null)}
          title={`Feature flags: ${flagTenant.name}`}
          description="Overrides plan defaults for staged rollout."
          icon="settings"
          confirmLabel="Apply flags"
          onConfirm={async () => {
            await api.setTenantFlags(flagTenant.id, flags);
            tenants.reload();
          }}
        >
          <div className="flex flex-col gap-2">
            {FLAGS.map((f) => (
              <CheckboxField
                key={f}
                label={f}
                checked={flags[f] ?? false}
                onChange={(checked) => setFlags((prev) => ({ ...prev, [f]: checked }))}
              />
            ))}
          </div>
        </FormDialog>
      ) : null}

      {/* ---- Support session: audit-logged, so it is confirmed explicitly ---- */}
      {supportTarget ? (
        <FormDialog
          isOpen
          onClose={() => setSupportTarget(null)}
          title="Start support session"
          description="You will act inside this tenant. Every action is attributed to you."
          icon="security"
          tone="danger"
          confirmLabel="Start session"
          onConfirm={async () => {
            const r = await api.impersonate(supportTarget.id, "support");
            tokenStore.set(r.token);
            // A hard navigation on purpose: the identity changed, so every provider
            // (auth, i18n, the live socket) must rebuild from scratch. router.push
            // would keep the old session's React tree and its open WebSocket.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.href = "/dashboard";
          }}
        >
          <div className="group-panel px-4 py-1">
            <DetailRow label="Organization">{supportTarget.name}</DetailRow>
            <DetailRow label="Plan">{supportTarget.plan_tier}</DetailRow>
            <DetailRow label="Screens">{supportTarget.usage.screens}</DetailRow>
          </div>
          <p className="flex items-start gap-2 text-footnote text-muted">
            <Icon name="audit" size={14} className="mt-px shrink-0" />
            This session is written to the tenant&apos;s audit log and is visible to them.
          </p>
        </FormDialog>
      ) : null}
    </div>
  );
}
