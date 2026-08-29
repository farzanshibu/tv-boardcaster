"use client";

// SOT: accept-invite-page
// WHAT:  a new member sets a password and joins the organization.
// WHY:   invites are single-use tokens issued by an admin.
// HOW:   the token comes from the query string; success signs the user straight in.
// WHERE: api.acceptInvite

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Button, Card } from "@heroui/react";
import { api, describeError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n";
import { TextInput } from "@/components/global/form";

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
    <main className="grid min-h-screen place-items-center p-6">
      <Card className="w-full max-w-md">
        <Card.Header>
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-accent">Brandcast TV</p>
          <Card.Title className="mt-1 text-2xl">{t("invite.title")}</Card.Title>
          <Card.Description>{t("invite.sub")}</Card.Description>
        </Card.Header>
        <Card.Content className="flex flex-col gap-3">
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
          <Button variant="primary" className="mt-2 w-full" isPending={busy} onPress={submit}>
            {t("invite.join")}
          </Button>
        </Card.Content>
      </Card>
    </main>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteForm />
    </Suspense>
  );
}
