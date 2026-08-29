"use client";

// SOT: i18n-provider, translate-hook, locale-persistence
// WHAT:  supplies the active locale and the t() translator to every client component.
// WHY:   the dictionary is typed, so t("nav.sceens") fails to compile.
// HOW:   provider sets <html lang/dir> so RTL layout follows the locale automatically.
// WHERE: strings live in ./dictionaries.ts

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from "react";
import { DICTIONARIES, LOCALES, RTL_LOCALES, type Locale, type TranslationKey } from "./dictionaries";

const STORAGE_KEY = "bc_locale";

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  dir: "ltr" | "rtl";
}

const I18nContext = createContext<I18nValue | null>(null);

const isLocale = (v: string | null): v is Locale => v !== null && v in LOCALES;

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  // Read the stored preference after mount so server and client markup agree.
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) { setLocaleState(stored); return; }
    const nav = window.navigator.language.slice(0, 2);
    if (isLocale(nav)) setLocaleState(nav);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = RTL_LOCALES.has(locale) ? "rtl" : "ltr";
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    window.localStorage.setItem(STORAGE_KEY, l);
  }, []);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>): string => {
      let out = DICTIONARIES[locale][key] ?? DICTIONARIES.en[key];
      if (vars) {
        for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
      }
      return out;
    },
    [locale],
  );

  const value = useMemo<I18nValue>(
    () => ({ locale, setLocale, t, dir: RTL_LOCALES.has(locale) ? "rtl" : "ltr" }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}

/** Currency follows the organization; digit grouping follows the reader. */
export function formatMoney(amount: number, currency: string, locale: Locale): string {
  const region = currency === "INR" ? "IN" : "US";
  return new Intl.NumberFormat(`${locale}-${region}`, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

export const formatNumber = (n: number, locale: Locale): string =>
  new Intl.NumberFormat(locale).format(n || 0);

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const secs = (Date.now() - Date.parse(iso)) / 1000;
  if (secs < 60) return `${Math.round(secs)}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

export const formatDate = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString() : "—";
