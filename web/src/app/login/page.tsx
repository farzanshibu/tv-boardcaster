"use client";

// SOT: login-page, signup-flow, totp-challenge, auth-window
// WHAT:  sign-in, self-serve signup and the 2FA challenge in one window.
// WHY:   signup creates the tenant, so it belongs beside login, not on its own route.
// HOW:   presented as a floating macOS window with traffic lights and a titlebar,
//        which is the first thing a new operator sees and sets the whole tone.
//        On success the token goes to the auth context, which redirects to /dashboard.
// WHERE: api.login / api.signup in src/lib/api.ts

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button } from "@heroui/react";
import { SegmentedControl, SelectField, TextInput } from "@/components/global/form";
import { Icon } from "@/components/global/icon";
import { AuthWindow } from "@/components/global/auth-window";
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

  const title =
    mode === "signup" ? t("auth.signup_title")
    : mode === "totp" ? t("auth.totp")
    : t("auth.signin");

  const subtitle =
    mode === "signup" ? t("auth.signup_sub")
    : mode === "totp" ? "Enter the 6-digit code from your authenticator app."
    : t("auth.signin_sub");

  return (
    <AuthWindow windowTitle="Brandcast TV" title={title} subtitle={subtitle}>
      {/* The 2FA challenge is a continuation, not a third tab, so the switcher hides. */}
      {mode !== "totp" ? (
        <SegmentedControl
          ariaLabel="Sign in or create an account"
          className="w-full [&>button]:flex-1"
          value={mode}
          onChange={(m) => { setMode(m); setError(null); }}
          options={[
            { id: "login", label: t("auth.signin") },
            { id: "signup", label: t("auth.need_account") },
          ]}
        />
      ) : null}

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

      {mode === "totp" ? (
        <TextInput label={t("auth.totp")} value={totp} onChange={setTotp} placeholder="123456" onEnter={submit} />
      ) : (
        <>
          <TextInput label={t("auth.email")} value={email} onChange={setEmail} type="email" placeholder="you@company.com" onEnter={submit} />
          <TextInput label={t("auth.password")} value={password} onChange={setPassword} type="password" placeholder="••••••••" onEnter={submit} />
        </>
      )}

      <Button variant="primary" isPending={busy} onPress={submit} className="mt-1 w-full">
        {mode === "signup" ? t("auth.create") : t("auth.signin")}
      </Button>

      {mode === "totp" ? (
        <Button variant="ghost" size="sm" onPress={() => { setMode("login"); setTotp(""); }}>
          <Icon name="chevronLeft" size={13} className="rtl:rotate-180" />
          Back to sign in
        </Button>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t border-separator pt-3">
        <button
          type="button"
          onClick={() => { window.open("/tv", "_blank"); }}
          className="inline-flex items-center gap-1.5 text-footnote text-accent transition-colors duration-150 ease-mac hover:underline"
        >
          <Icon name="tv" size={13} />
          {t("auth.open_tv")}
        </button>
        <SelectField
          ariaLabel={t("common.language")}
          selected={locale}
          onSelect={(id) => setLocale(id as Locale)}
          options={Object.entries(LOCALES).map(([id, label]) => ({ id, label }))}
          className="w-[132px]"
        />
      </div>
    </AuthWindow>
  );
}
