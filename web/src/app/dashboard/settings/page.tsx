"use client";

// SOT: settings-page, org-preferences, two-factor
// WHAT:  organization policy and the signed-in user's own security settings.
// WHY:   2FA enforcement and content approval are org-wide switches in the PRD.
// HOW:   saving reloads the session so gates react immediately.
// WHERE: src/routes/accounts.js

import { useState } from "react";
import { Button, Chip } from "@heroui/react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { permission } from "@/lib/resources";
import { ErrorBlock, LoadingBlock, PageHeader, SectionCard } from "@/components/global/ui";
import { FormDialog } from "@/components/global/form-dialog";
import { TextInput } from "@/components/global/form";

export default function SettingsPage() {
  const { t } = useI18n();
  const { session, refresh, can } = useAuth();

  const [name, setName] = useState(session?.org?.name ?? "");
  const [gstin, setGstin] = useState(session?.org?.gstin ?? "");
  const [require2fa, setRequire2fa] = useState(session?.org?.require_2fa ?? false);
  const [approval, setApproval] = useState(session?.org?.approval_required ?? false);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!session) return <LoadingBlock />;
  const org = session.org;

  return (
    <div>
      <PageHeader title={t("nav.settings")} />
      {error ? <ErrorBlock message={error} /> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title={t("settings.org")}>
          {org ? (
            <div className="flex flex-col gap-3">
              <TextInput label="Name" value={name} onChange={setName} />
              <TextInput label="GSTIN (India)" value={gstin} onChange={setGstin} placeholder="29AABCB1234C1ZX" />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={require2fa} onChange={(e) => setRequire2fa(e.target.checked)} />
                Require 2FA for all members
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} />
                Require admin approval before content publishes
              </label>
              {can(permission("settings", "update")) ? (
                <Button
                  variant="primary"
                  className="mt-1 self-start"
                  onPress={() => {
                    void api.updateOrg({ name, gstin, require_2fa: require2fa, approval_required: approval })
                      .then(() => refresh())
                      .catch((e: unknown) => setError(String(e)));
                  }}
                >
                  {t("common.save")}
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted">Platform operators have no tenant settings.</p>
          )}
        </SectionCard>

        <SectionCard title={t("settings.account")}>
          <p className="text-sm">{session.user.name}</p>
          <p className="mb-3 text-xs text-muted">{session.user.email}</p>
          <div className="mb-4 flex gap-2">
            <Chip variant="soft" color="accent">{session.user.role}</Chip>
            <Chip variant="soft" color={session.user.two_factor ? "success" : "default"}>
              {session.user.two_factor ? "2FA on" : "2FA off"}
            </Chip>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onPress={() => void api.setup2fa().then((r) => setSecret(r.secret))}>
              {session.user.two_factor ? "Re-enrol 2FA" : "Enable 2FA"}
            </Button>
            {session.user.two_factor && !org?.require_2fa ? (
              <Button size="sm" variant="ghost" onPress={() => void api.disable2fa().then(() => refresh())}>
                Disable 2FA
              </Button>
            ) : null}
          </div>

          <p className="mt-5 text-sm font-medium">TV client</p>
          <p className="text-sm text-muted">Open the kiosk player on any smart TV, then pair with the code shown.</p>
          <a href="/tv" target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-accent hover:underline">
            {t("action.opentv")} →
          </a>

          {session.plan ? (
            <>
              <p className="mt-5 text-sm font-medium">Plan features</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {session.plan.features.map((f) => <Chip key={f} variant="soft">{f}</Chip>)}
              </div>
            </>
          ) : null}
        </SectionCard>
      </div>

      {secret ? (
        <FormDialog
          isOpen
          onClose={() => { setSecret(null); void refresh(); }}
          title="Two-factor authentication"
          description="Add this secret to your authenticator app."
        >
          <p className="break-all rounded-lg border border-success/40 bg-success-soft p-3 font-mono text-sm">{secret}</p>
          <p className="text-sm text-muted">You will be asked for a 6-digit code at next sign-in.</p>
        </FormDialog>
      ) : null}
    </div>
  );
}
