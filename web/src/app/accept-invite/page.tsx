"use client";

// SOT: accept-invite-page
// WHAT:  a new member sets a password and joins the organization.
// WHY:   invites are single-use tokens issued by an admin.
// HOW:   the token comes from the query string; success signs the user straight in.
//        Shares the AuthWindow chrome with /login so both entry points match.
// WHERE: api.acceptInvite

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Button } from "@heroui/react";
import { api, describeError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n";
import { TextInput } from "@/components/global/form";
import { AuthWindow } from "@/components/global/auth-window";

function AcceptInviteForm() {
  const { t } = useI18n();
  const { signIn } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = () => {
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        const r = await api.acceptInvite(token, name, password);
        await signIn(r.token);
        router.replace("/dashboard");
      } catch (e: unknown) {
        setError(describeError(e));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <AuthWindow windowTitle="Brandcast TV" title={t("invite.title")} subtitle={t("invite.sub")}>
      {error ? (
        <Alert status="danger">
          <Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content>
        </Alert>
      ) : null}
      <TextInput label={t("auth.name")} value={name} onChange={setName} onEnter={submit} />
      <TextInput
        label={t("auth.password")}
        value={password}
        onChange={setPassword}
        type="password"
        placeholder={t("invite.password_hint")}
        onEnter={submit}
      />
      <Button variant="primary" className="mt-1 w-full" isPending={busy} onPress={submit}>
        {t("invite.join")}
      </Button>
    </AuthWindow>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteForm />
    </Suspense>
  );
}
