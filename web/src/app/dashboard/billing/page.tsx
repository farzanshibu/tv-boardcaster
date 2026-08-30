"use client";

// SOT: billing-page, plan-selection, invoices
// WHAT:  plan, usage against limits, and GST-compliant invoices.
// WHY:   per-screen SaaS billing is the revenue model in the PRD.
// HOW:   the gateway is abstracted server-side; no card data reaches this app.
// WHERE: src/routes/insights.js billing endpoints

import { useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@heroui/react";
import { useQuery } from "@/lib/use-query";
import { useI18n, formatMoney, formatDate } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { permission, PLAN_ORDER } from "@/lib/resources";
import { Icon } from "@/components/global/icon";
import {
  DataTable, EmptyState, ErrorBlock, InlineNotice, LoadingBlock, PageHeader,
  SectionCard, StatCard, StatusPill, Td, Tr,
} from "@/components/global/ui";
import { FormDialog } from "@/components/global/form-dialog";
import { SegmentedControl, SelectField } from "@/components/global/form";
import type { PlanKey } from "@/lib/types";

export default function BillingPage() {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const billing = useQuery(() => api.billing());

  const [planKey, setPlanKey] = useState<PlanKey | null>(null);
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");
  const [gateway, setGateway] = useState("razorpay");

  if (billing.loading && !billing.data) return <LoadingBlock rows={4} />;
  if (billing.error) return <ErrorBlock message={billing.error} onRetry={billing.reload} />;
  if (!billing.data) return null;

  const b = billing.data;
  const currency = b.estimated_next_invoice.currency;
  const current = b.subscription.plan;
  const mayPay = can(permission("billing", "update"));

  return (
    <div>
      <PageHeader
        title={t("nav.billing")}
        subtitle={b.plan.name}
        actions={
          <StatusPill
            tone={b.subscription.status === "active" ? "success" : "warning"}
            icon={b.subscription.status === "active" ? "success" : "time"}
          >
            {b.subscription.status}
          </StatusPill>
        }
      />

      {b.near_limit ? (
        <InlineNotice icon="warning" tone="warning">
          Close to your plan limits: {b.usage.screens} of {b.plan.max_screens} screens,{" "}
          {b.usage.users} of {b.plan.max_users} users.
        </InlineNotice>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon="billing" label={t("billing.current_plan")} value={b.plan.name} hint={b.subscription.status} />
        <StatCard icon="screens" label={t("billing.active_screens")} value={`${b.usage.screens}/${b.plan.max_screens}`} />
        <StatCard
          icon="invoice"
          label={t("billing.next_invoice")}
          value={formatMoney(b.estimated_next_invoice.subtotal + b.estimated_next_invoice.tax, currency, locale)}
          hint={b.estimated_next_invoice.tax ? "incl. GST 18%" : "no tax"}
        />
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(Object.entries(b.plans) as [PlanKey, typeof b.plan][]).map(([key, p]) => {
          const isCurrent = key === current;
          return (
            <div
              key={key}
              className={`group-panel flex flex-col gap-3 p-5 ${
                isCurrent ? "border-accent ring-1 ring-accent" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-callout font-semibold text-foreground">{p.name}</p>
                {isCurrent ? (
                  <StatusPill tone="accent" icon="check">Current</StatusPill>
                ) : null}
              </div>

              <p className="text-title2 font-semibold tabular-nums tracking-[-0.02em] text-foreground">
                {p.price_per_screen ? formatMoney(p.price_per_screen, currency, locale) : "Free"}
                {p.price_per_screen ? (
                  <span className="ms-1 text-footnote font-normal text-muted">/screen/mo</span>
                ) : null}
              </p>

              <ul className="flex flex-1 flex-col gap-1.5 text-footnote text-muted">
                <li className="flex items-start gap-1.5">
                  <Icon name="check" size={12} className="mt-0.5 shrink-0 text-success" />
                  {p.max_screens} screens
                </li>
                <li className="flex items-start gap-1.5">
                  <Icon name="check" size={12} className="mt-0.5 shrink-0 text-success" />
                  {p.max_users} users
                </li>
                {p.features.slice(3).map((f) => (
                  <li key={f} className="flex items-start gap-1.5">
                    <Icon name="check" size={12} className="mt-0.5 shrink-0 text-success" />
                    {f}
                  </li>
                ))}
              </ul>

              {mayPay && !isCurrent ? (
                <Button
                  variant="primary"
                  size="sm"
                  className="w-full"
                  onPress={() => { setPlanKey(key); setCycle("monthly"); }}
                >
                  {/* Compare tier position, not per-screen price. Enterprise costs
                      less per screen than Growth by design (volume pricing), so a
                      price comparison would label it a downgrade. */}
                  {PLAN_ORDER.indexOf(key) < PLAN_ORDER.indexOf(current)
                    ? t("billing.downgrade")
                    : t("billing.upgrade")}
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>

      <SectionCard flush className="mt-5" title={t("billing.invoices")}>
        {b.invoices.length === 0 ? (
          <EmptyState
            icon="invoice"
            title="No invoices yet"
            hint="Invoices appear here once a paid plan starts."
          />
        ) : (
          <DataTable head={["Invoice", "Plan", "Screens", "Subtotal", "Tax", "Total", "Date"]}>
            {b.invoices.map((i) => (
              <Tr key={i.id}>
                <Td className="font-mono text-caption">{i.number}</Td>
                <Td>{i.plan}</Td>
                <Td className="tabular-nums">{i.screens}</Td>
                <Td className="tabular-nums">{formatMoney(i.subtotal, i.currency, locale)}</Td>
                <Td className="tabular-nums text-muted">{formatMoney(i.tax, i.currency, locale)}</Td>
                <Td className="font-semibold tabular-nums">{formatMoney(i.total, i.currency, locale)}</Td>
                <Td className="text-footnote text-muted">{formatDate(i.created_at)}</Td>
              </Tr>
            ))}
          </DataTable>
        )}
      </SectionCard>

      {planKey ? (
        <FormDialog
          isOpen
          onClose={() => setPlanKey(null)}
          title={`Subscribe to ${b.plans[planKey].name}`}
          description={`${formatMoney(b.plans[planKey].price_per_screen, currency, locale)} per screen per month, for ${b.usage.screens} screens.`}
          icon="billing"
          confirmLabel="Confirm subscription"
          onConfirm={async () => {
            await api.subscribe(planKey, cycle, gateway);
            billing.reload();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <span className="text-body font-medium text-foreground">Billing cycle</span>
            <SegmentedControl
              ariaLabel="Billing cycle"
              value={cycle}
              onChange={setCycle}
              options={[
                { id: "monthly", label: "Monthly" },
                { id: "yearly", label: "Yearly (15% off)" },
              ]}
            />
          </div>
          <SelectField
            label="Payment gateway"
            options={[
              { id: "razorpay", label: "Razorpay (UPI, cards, India)" },
              { id: "stripe", label: "Stripe (international cards)" },
            ]}
            selected={gateway}
            onSelect={setGateway}
          />
          <p className="flex items-start gap-2 rounded-field bg-surface-secondary p-3 text-footnote text-muted">
            <Icon name="security" size={14} className="mt-px shrink-0" />
            Card data is handled by the PCI-DSS compliant gateway. Brandcast TV never stores it.
          </p>
        </FormDialog>
      ) : null}
    </div>
  );
}
