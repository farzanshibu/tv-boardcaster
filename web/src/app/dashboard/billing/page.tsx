"use client";

// SOT: billing-page, plan-selection, invoices
// WHAT:  plan, usage against limits, and GST-compliant invoices.
// WHY:   per-screen SaaS billing is the revenue model in the PRD.
// HOW:   the gateway is abstracted server-side; no card data reaches this app.
// WHERE: src/routes/insights.js billing endpoints

import { useState } from "react";
import { Button, Chip } from "@heroui/react";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { useI18n, formatMoney, formatDate } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { permission } from "@/lib/resources";
import { DataTable, EmptyState, ErrorBlock, LoadingBlock, PageHeader, SectionCard, StatCard, Td } from "@/components/global/ui";
import { FormDialog } from "@/components/global/form-dialog";
import { SelectField } from "@/components/global/form";
import type { PlanKey } from "@/lib/types";

export default function BillingPage() {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const billing = useQuery(() => api.billing());

  const [planKey, setPlanKey] = useState<PlanKey | null>(null);
  const [cycle, setCycle] = useState("monthly");
  const [gateway, setGateway] = useState("razorpay");

  if (billing.loading && !billing.data) return <LoadingBlock label={t("common.loading")} />;
  if (billing.error) return <ErrorBlock message={billing.error} onRetry={billing.reload} />;
  if (!billing.data) return null;

  const b = billing.data;
  const currency = b.estimated_next_invoice.currency;
  const current = b.subscription.plan;
  const mayPay = can(permission("billing", "update"));

  return (
    <div>
      <PageHeader title={t("nav.billing")} subtitle={b.subscription.status} />

      {b.near_limit ? (
        <div className="mb-5 rounded-xl border border-accent/40 bg-accent-soft p-4 text-sm">
          You are close to your plan limits ({b.usage.screens}/{b.plan.max_screens} screens, {b.usage.users}/{b.plan.max_users} users).
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t("billing.current_plan")} value={b.plan.name} hint={b.subscription.status} />
        <StatCard label={t("billing.active_screens")} value={`${b.usage.screens}/${b.plan.max_screens}`} />
        <StatCard
          label={t("billing.next_invoice")}
          value={formatMoney(b.estimated_next_invoice.subtotal + b.estimated_next_invoice.tax, currency, locale)}
          hint={b.estimated_next_invoice.tax ? "incl. GST 18%" : "no tax"}
        />
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(Object.entries(b.plans) as [PlanKey, typeof b.plan][]).map(([key, p]) => (
          <div key={key} className={`panel p-5 ${key === current ? "border-accent shadow-[inset_0_0_0_1px_var(--color-accent)]" : ""}`}>
            <div className="flex items-center justify-between">
              <p className="font-semibold">{p.name}</p>
              {key === current ? <Chip color="success" variant="soft">current</Chip> : null}
            </div>
            <p className="mt-2 text-2xl font-bold">
              {p.price_per_screen ? formatMoney(p.price_per_screen, currency, locale) : "Free"}
              {p.price_per_screen ? <span className="text-xs font-normal text-muted"> /screen/mo</span> : null}
            </p>
            <ul className="mt-3 flex flex-col gap-1 text-sm text-muted">
              <li>✓ {p.max_screens} screens</li>
              <li>✓ {p.max_users} users</li>
              {p.features.slice(3).map((f) => <li key={f}>✓ {f}</li>)}
            </ul>
            {mayPay && key !== current ? (
              <Button
                variant="primary"
                size="sm"
                className="mt-4 w-full"
                onPress={() => { setPlanKey(key); setCycle("monthly"); }}
              >
                {b.plans[current].price_per_screen > p.price_per_screen ? t("billing.downgrade") : t("billing.upgrade")}
              </Button>
            ) : null}
          </div>
        ))}
      </div>

      <SectionCard className="mt-5" title={t("billing.invoices")}>
        {b.invoices.length === 0 ? (
          <EmptyState title="No invoices yet." />
        ) : (
          <DataTable head={["Invoice", "Plan", "Screens", "Subtotal", "Tax", "Total", "Date"]}>
            {b.invoices.map((i) => (
              <tr key={i.id}>
                <Td className="font-mono text-xs">{i.number}</Td>
                <Td>{i.plan}</Td>
                <Td className="tabular-nums">{i.screens}</Td>
                <Td className="tabular-nums">{formatMoney(i.subtotal, i.currency, locale)}</Td>
                <Td className="tabular-nums text-muted">{formatMoney(i.tax, i.currency, locale)}</Td>
                <Td className="font-semibold tabular-nums">{formatMoney(i.total, i.currency, locale)}</Td>
                <Td className="text-muted">{formatDate(i.created_at)}</Td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>

      {planKey ? (
        <FormDialog
          isOpen
          onClose={() => setPlanKey(null)}
          title={`Subscribe to ${b.plans[planKey].name}`}
          description={`${formatMoney(b.plans[planKey].price_per_screen, currency, locale)} per screen / month · ${b.usage.screens} screens`}
          confirmLabel="Confirm subscription"
          onConfirm={async () => {
            await api.subscribe(planKey, cycle, gateway);
            billing.reload();
          }}
        >
          <SelectField
            label="Billing cycle"
            options={[{ id: "monthly", label: "Monthly" }, { id: "yearly", label: "Yearly (15% off)" }]}
            selected={cycle}
            onSelect={setCycle}
          />
          <SelectField
            label="Payment gateway"
            options={[
              { id: "razorpay", label: "Razorpay (UPI, cards — India)" },
              { id: "stripe", label: "Stripe (international cards)" },
            ]}
            selected={gateway}
            onSelect={setGateway}
          />
          <p className="text-sm text-muted">
            Card data is handled by the PCI-DSS compliant gateway; Brandcast TV never stores it.
          </p>
        </FormDialog>
      ) : null}
    </div>
  );
}
