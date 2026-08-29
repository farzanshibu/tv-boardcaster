"use client";

// SOT: login-page, signup-flow, totp-challenge
// WHAT:  sign-in, self-serve signup and the 2FA challenge in one form.
// WHY:   signup creates the tenant, so it belongs beside login, not on its own route.
// HOW:   on success the token goes to the auth context, which redirects to /dashboard.
// WHERE: api.login / api.signup in src/lib/api.ts

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Alert, Button, Card } from "@heroui/react";
import { SelectField, TextInput } from "@/components/global/form";
import { api, ApiError, describeError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n";
import { LOCALES, type Locale } from "@/lib/dictionaries";

type Mode = "login" | "signup" | "totp";

export default function LoginPage() {
  const { t, locale, setLocale } = useI18n();
  const { signIn, session } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [country, setCountry] = useState("IN");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (session) router.replace("/dashboard"); }, [session, router]);

  const submit = (): void => { void doSubmit(); };

  const doSubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result =
        mode === "signup"
          ? await api.signup({ name, email, password, org_name: org, country })
          : await api.login(email, password, mode === "totp" ? totp : undefined);
      await signIn(result.token);
      router.replace("/dashboard");
    } catch (e: unknown) {
      if (e instanceof ApiError && e.code === "totp_required") {
        setMode("totp");
        setError(null);
      } else {
        setError(describeError(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-linear-to-br from-surface-secondary to-background p-6">
      <Card className="w-full max-w-md">
        <Card.Header>
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-accent">Brandcast TV</p>
          <Card.Title className="mt-1 text-2xl">
            {mode === "signup" ? t("auth.signup_title") : t("auth.signin")}
          </Card.Title>
          <Card.Description>
            {mode === "signup" ? t("auth.signup_sub") : t("auth.signin_sub")}
          </Card.Description>
        </Card.Header>

        <Card.Content className="flex flex-col gap-3">
          {error ? (
            <Alert status="danger">
              <Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content>
            </Alert>
          ) : null}

          {mode === "signup" ? (
            <>
              <TextInput label={t("auth.name")} value={name} onChange={setName} placeholder="Riya Sharma" onEnter={submit} />
              <TextInput label={t("auth.org")} value={org} onChange={setOrg} placeholder="Acme Retail" onEnter={submit} />
              <SelectField
                label={t("auth.country")}
                selected={country}
                onSelect={setCountry}
                options={[
                  { id: "IN", label: "India (GST invoicing)" },
                  { id: "US", label: "United States" },
                ]}
              />
            </>
          ) : null}

          <TextInput label={t("auth.email")} value={email} onChange={setEmail} type="email" placeholder="you@company.com" onEnter={submit} />
          <TextInput label={t("auth.password")} value={password} onChange={setPassword} type="password" placeholder="********" onEnter={submit} />

          {mode === "totp" ? (
            <TextInput label={t("auth.totp")} value={totp} onChange={setTotp} placeholder="123456" onEnter={submit} />
          ) : null}

          <Button variant="primary" isPending={busy} onPress={submit} className="mt-2 w-full">
            {mode === "signup" ? t("auth.create") : t("auth.signin")}
          </Button>

          <div className="flex items-center justify-between gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onPress={() => { setMode(mode === "signup" ? "login" : "signup"); setError(null); }}
            >
              {mode === "signup" ? t("auth.have_account") : t("auth.need_account")}
            </Button>
            <Link href="/tv" target="_blank" className="text-sm text-accent hover:underline">
              {t("auth.open_tv")} →
            </Link>
          </div>

          <SelectField
            ariaLabel={t("common.language")}
            selected={locale}
            onSelect={(id) => setLocale(id as Locale)}
            options={Object.entries(LOCALES).map(([id, label]) => ({ id, label }))}
            className="w-full pt-2"
          />
        </Card.Content>
      </Card>
    </main>
  );
}
