"use client";

// SOT: auth-window, unauthenticated-chrome
// WHAT:  the floating macOS window that hosts sign-in, signup and invite acceptance.
// WHY:   the unauthenticated pages are the first impression. Presenting them as a
//        real window, with traffic lights and a titlebar, sets the desktop-app tone
//        before the operator has seen a single dashboard route.
// HOW:   a centred sheet-radius panel with window elevation over a tinted desktop
//        backdrop. The backdrop uses two very low-chroma accent washes, which is
//        atmosphere rather than the banned decorative gradient.
// WHERE: tokens and materials in src/app/globals.css

import type { ReactNode } from "react";

export function AuthWindow({
  windowTitle, title, subtitle, children,
}: {
  windowTitle: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden p-6">
      {/* Desktop backdrop: two faint washes so the window reads as floating above
          something, the way a Mac window sits on a wallpaper. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60rem 34rem at 18% -10%, var(--color-accent-soft), transparent 62%)," +
            "radial-gradient(52rem 30rem at 88% 6%, var(--color-accent-soft), transparent 60%)",
        }}
      />

      <div
        className="w-full max-w-[400px] overflow-hidden rounded-sheet border border-border bg-surface"
        style={{ boxShadow: "var(--window-shadow)" }}
      >
        {/* Titlebar */}
        <div className="material-toolbar flex h-[38px] items-center gap-2.5 border-b border-border px-3.5">
          <span aria-hidden="true" className="flex items-center gap-[6px]">
            <span className="size-[11px] rounded-full bg-[#ff5f57] ring-[0.5px] ring-black/12" />
            <span className="size-[11px] rounded-full bg-[#febc2e] ring-[0.5px] ring-black/12" />
            <span className="size-[11px] rounded-full bg-[#28c840] ring-[0.5px] ring-black/12" />
          </span>
          <span className="flex-1 truncate text-center text-caption font-semibold text-muted">
            {windowTitle}
          </span>
          {/* Balances the traffic lights so the title centres optically. */}
          <span aria-hidden="true" className="w-[45px]" />
        </div>

        <div className="p-6">
          <h1 className="text-title2 font-semibold tracking-[-0.015em] text-foreground">{title}</h1>
          {subtitle ? <p className="mt-1 text-footnote text-muted">{subtitle}</p> : null}
          <div className="mt-5 flex flex-col gap-3">{children}</div>
        </div>
      </div>
    </main>
  );
}
