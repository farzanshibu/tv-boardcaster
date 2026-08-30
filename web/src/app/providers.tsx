"use client";

// SOT: client-providers
// WHAT:  composes the client-side context providers in dependency order.
// WHY:   auth needs a router and i18n needs the DOM, so both are client-only.
// HOW:   Appearance is outermost because it touches <html> and must settle before
//        anything renders. I18n wraps Auth so sign-out toasts and guards translate.
// WHERE: src/lib/appearance.tsx, src/lib/i18n.tsx, src/lib/auth-context.tsx

import type { ReactNode } from "react";
import { AppearanceProvider } from "@/lib/appearance";
import { I18nProvider } from "@/lib/i18n";
import { AuthProvider } from "@/lib/auth-context";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AppearanceProvider>
      <I18nProvider>
        <AuthProvider>{children}</AuthProvider>
      </I18nProvider>
    </AppearanceProvider>
  );
}
