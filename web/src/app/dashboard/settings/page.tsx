"use client";

// SOT: settings-page, org-preferences, two-factor
// WHAT:  organization policy and the signed-in user's own security settings.
// WHY:   2FA enforcement and content approval are org-wide switches in the PRD.
// HOW:   saving reloads the session so gates react immediately. Policy rows follow
//        the macOS System Settings pattern: label, explanation, control on the end.
// WHERE: src/routes/accounts.js

import { useState } from "react";
import { Button } from "@heroui/react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { permission } from "@/lib/resources";
import { Icon } from "@/components/global/icon";
import {
  DetailRow, ErrorBlock, LoadingBlock, PageHeader, SectionCard, StatusPill,
} from "@/components/global/ui";
import { FormDialog } from "@/components/global/form-dialog";
import { CheckboxField, TextInput } from "@/components/global/form";

/** System Settings style row: title, explanation, trailing control. */
function PolicyRow({
  title, description, children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-separator py-3 first:border-t-0">
      <div className="min-w-0">
        <p className="text-body font-medium text-foreground">{title}</p>
        <p className="text-footnote text-muted">{description}</p>
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const { t } = useI18n();
  const { session, refresh, can } = useAuth();

  const [name, setName] = useState(session?.org?.name ?? "");
  const [gstin, setGstin] = useState(session?.org?.gstin ?? "");
  const [require2fa, setRequire2fa] = useState(session?.org?.require_2fa ?? false);
  const [approval, setApproval] = useState(session?.org?.approval_required ?? false);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!session) return <LoadingBlock rows={4} />;
  const org = session.org;

  return (
    <div>
      <PageHeader title={t("nav.settings")} subtitle={org ? org.name : "Platform operations"} />
      {error ? <ErrorBlock message={error} /> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title={t("settings.org")}>
          {org ? (
            <div className="flex flex-col gap-3">
              <TextInput label="Name" value={name} onChange={setName} />
              <TextInput
                label="GSTIN"
                value={gstin}
                onChange={setGstin}
                placeholder="29AABCB1234C1ZX"
                description="India only. Appears on every invoice."
              />

              <div className="mt-1">
                <PolicyRow
                  title="Require two-factor"
                  description="Every member must enrol an authenticator app."
                >
                  <CheckboxField label="" checked={require2fa} onChange={setRequire2fa} />
                </PolicyRow>
                <PolicyRow
                  title="Require approval to publish"
                  description="Content editors submit; an admin approves before it reaches a screen."
                >
                  <CheckboxField label="" checked={approval} onChange={setApproval} />
                </PolicyRow>
              </div>

              {can(permission("settings", "update")) ? (
                <div className="flex items-center gap-2.5 border-t border-separator pt-3">
                  <Button
                    variant="primary"
                    size="sm"
                    onPress={() => {
                      void api.updateOrg({ name, gstin, require_2fa: require2fa, approval_required: approval })
                        .then(() => refresh())
                        .then(() => { setSaved(true); setTimeout(() => setSaved(false), 2400); })
                        .catch((e: unknown) => setError(String(e)));
                    }}
                  >
                    {t("common.save")}
                  </Button>
                  {saved ? (
                    <StatusPill tone="success" icon="success">Saved</StatusPill>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-body text-muted">Platform operators have no tenant settings.</p>
          )}
        </SectionCard>

        <SectionCard title={t("settings.account")}>
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
              <Icon name="team" size={19} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-callout font-semibold text-foreground">{session.user.name}</p>
              <p className="truncate text-footnote text-muted">{session.user.email}</p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <StatusPill tone="accent" icon="team">{session.user.role}</StatusPill>
            <StatusPill
              tone={session.user.two_factor ? "success" : "neutral"}
              icon={session.user.two_factor ? "verified" : "security"}
            >
              {session.user.two_factor ? "Two-factor on" : "Two-factor off"}
            </StatusPill>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 border-t border-separator pt-4">
            <Button size="sm" variant="outline" onPress={() => void api.setup2fa().then((r) => setSecret(r.secret))}>
              <Icon name="security" size={13} />
              {session.user.two_factor ? "Re-enrol two-factor" : "Enable two-factor"}
            </Button>
            {session.user.two_factor && !org?.require_2fa ? (
              <Button size="sm" variant="ghost" onPress={() => void api.disable2fa().then(() => refresh())}>
                Disable
              </Button>
            ) : null}
          </div>

          <div className="mt-4 border-t border-separator pt-4">
            <p className="text-body font-medium text-foreground">TV client</p>
            <p className="mt-0.5 text-footnote text-muted">
              Open the kiosk player on any smart TV, then pair with the code it shows.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2.5"
              onPress={() => { window.open("/tv", "_blank"); }}
            >
              <Icon name="tv" size={13} />
              {t("action.opentv")}
            </Button>
          </div>

          {session.plan ? (
            <div className="mt-4 border-t border-separator pt-4">
              <p className="mb-2 text-body font-medium text-foreground">Plan features</p>
              <div className="flex flex-wrap gap-1.5">
                {session.plan.features.map((f) => (
                  <StatusPill key={f} tone="neutral" icon="check">{f}</StatusPill>
                ))}
              </div>
            </div>
          ) : null}
        </SectionCard>
      </div>

      {secret ? (
        <FormDialog
          isOpen
          onClose={() => { setSecret(null); void refresh(); }}
          title="Two-factor authentication"
          description="Add this secret to your authenticator app."
          icon="security"
          cancelLabel={t("common.done")}
        >
          <div className="group-panel px-4 py-1">
            <DetailRow label="Account">{session.user.email}</DetailRow>
          </div>
          <p className="break-all rounded-field border border-border bg-surface-secondary p-3 text-center font-mono text-callout tracking-[0.08em] text-foreground">
            {secret}
          </p>
          <p className="flex items-start gap-2 text-footnote text-muted">
            <Icon name="info" size={14} className="mt-px shrink-0" />
            You will be asked for a 6-digit code at your next sign-in.
          </p>
        </FormDialog>
      ) : null}
    </div>
  );
}
