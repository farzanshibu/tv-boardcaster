"use client";

// SOT: global-ui-primitives, page-chrome, status-indicators
// WHAT:  shared building blocks composed from HeroUI for every dashboard view.
// WHY:   copying a Card+Table shell into 13 views is how designs drift apart.
// HOW:   thin compositions over HeroUI; no hardcoded colours, theme tokens only.
// WHERE: HeroUI API notes in web/HEROUI-API-NOTES.md

import { Alert, Button, Card, Chip, Spinner } from "@heroui/react";
import type { ReactNode } from "react";

export function PageHeader({
  title, subtitle, actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatCard({
  label, value, hint, tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const toneClass =
    tone === "success" ? "text-success" :
    tone === "warning" ? "text-warning" :
    tone === "danger" ? "text-danger" : "text-foreground";
  return (
    <Card>
      <Card.Content className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
        <p className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</p>
        {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
      </Card.Content>
    </Card>
  );
}

export function StatusChip({ online }: { online: boolean }) {
  return (
    <Chip color={online ? "success" : "danger"} variant="soft">
      {online ? "online" : "offline"}
    </Chip>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-10 text-center">
      <p className="text-muted">{title}</p>
      {hint ? <p className="mt-1 text-sm text-muted">{hint}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function LoadingBlock({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 p-10 text-muted">
      <Spinner /> <span>{label}</span>
    </div>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert status="danger" className="my-3">
      <Alert.Content>
        <Alert.Title>Something went wrong</Alert.Title>
        <Alert.Description>{message}</Alert.Description>
      </Alert.Content>
      {onRetry ? (
        <Button size="sm" variant="outline" onPress={onRetry}>Retry</Button>
      ) : null}
    </Alert>
  );
}

/** Card wrapper with a title row, used by most list views. */
export function SectionCard({
  title, actions, children, className,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className ?? ""}>
      {title || actions ? (
        <Card.Header className="flex flex-row items-center justify-between gap-3">
          {title ? <Card.Title className="text-base">{title}</Card.Title> : <span />}
          {actions}
        </Card.Header>
      ) : null}
      <Card.Content>{children}</Card.Content>
    </Card>
  );
}

/** Minimal, accessible data table. HeroUI has no opinionated table shell. */
export function DataTable({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {head.map((h) => (
              <th
                key={h}
                className="border-b border-border px-3 py-2 text-start text-xs font-semibold uppercase tracking-wide text-muted"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={`border-b border-border px-3 py-2 align-middle ${className ?? ""}`}>{children}</td>;
}
