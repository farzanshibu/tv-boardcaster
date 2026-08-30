"use client";

// SOT: appearance, colour-scheme, theme-switching
// WHAT:  System / Light / Dark appearance, matching macOS System Settings.
// WHY:   DESIGN.md's scene is an operator in daylight *and* at 9pm. Neither mode
//        is the default; the operating system is.
// HOW:   localStorage and prefers-color-scheme are external stores, so this reads
//        them with useSyncExternalStore rather than mirroring them into state in an
//        effect. That keeps the server and client snapshots explicit, avoids the
//        cascading render the effect version caused, and means changing macOS
//        appearance updates the app live. A blocking script in the root layout
//        applies the class pre-paint, so there is no flash of the wrong appearance.
// WHERE: tokens in src/app/globals.css; the control is in dashboard-shell.tsx

import {
  createContext, useCallback, useContext, useMemo, useSyncExternalStore,
  type ReactNode,
} from "react";

export const APPEARANCES = ["system", "light", "dark"] as const;
export type Appearance = (typeof APPEARANCES)[number];
export type ResolvedAppearance = "light" | "dark";

export const APPEARANCE_STORAGE_KEY = "brandcast.appearance";

/**
 * Runs before first paint, inlined in <head>. Kept in sync with `apply()` below.
 * Reads storage, resolves `system` against the media query, and sets the class
 * so the first frame is already correct.
 */
export const APPEARANCE_BOOT_SCRIPT = `(function(){try{
var s=localStorage.getItem(${JSON.stringify(APPEARANCE_STORAGE_KEY)})||"system";
var d=s==="dark"||(s==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);
var e=document.documentElement;
e.classList.add(d?"dark":"light");
e.style.colorScheme=d?"dark":"light";
}catch(_){document.documentElement.classList.add("light");}})();`;

const DARK_QUERY = "(prefers-color-scheme: dark)";

function isAppearance(v: string | null): v is Appearance {
  return v === "system" || v === "light" || v === "dark";
}

/* -------------------------------------------------------- external store ---- */

/** Notified on both a storage write (same tab or another) and an OS change. */
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener("change", onChange);
  // Another tab changing the preference should update this one too.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    mq.removeEventListener("change", onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Snapshot is a stable string so useSyncExternalStore can compare cheaply. */
function getSnapshot(): string {
  const stored = localStorage.getItem(APPEARANCE_STORAGE_KEY);
  const appearance: Appearance = isAppearance(stored) ? stored : "system";
  const dark =
    appearance === "dark" ||
    (appearance === "system" && window.matchMedia(DARK_QUERY).matches);
  return `${appearance}:${dark ? "dark" : "light"}`;
}

/** The server cannot know the OS preference, so it renders the boot default. */
function getServerSnapshot(): string {
  return "system:light";
}

function apply(resolved: ResolvedAppearance): void {
  const el = document.documentElement;
  el.classList.toggle("dark", resolved === "dark");
  el.classList.toggle("light", resolved === "light");
  el.style.colorScheme = resolved;
}

/* -------------------------------------------------------------- context ---- */

interface AppearanceContextValue {
  appearance: Appearance;
  resolved: ResolvedAppearance;
  setAppearance: (next: Appearance) => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [appearancePart, resolvedPart] = snapshot.split(":");
  const appearance: Appearance = isAppearance(appearancePart ?? null) ? appearancePart as Appearance : "system";
  const resolved: ResolvedAppearance = resolvedPart === "dark" ? "dark" : "light";

  const setAppearance = useCallback((next: Appearance) => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, next);
    const dark = next === "dark" || (next === "system" && window.matchMedia(DARK_QUERY).matches);
    apply(dark ? "dark" : "light");
    emit();
  }, []);

  const value = useMemo(
    () => ({ appearance, resolved, setAppearance }),
    [appearance, resolved, setAppearance],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error("useAppearance must be used inside AppearanceProvider");
  return ctx;
}
