// SOT: root-layout, app-providers, appearance-boot
// WHAT:  the single HTML shell; mounts appearance, i18n and auth for every route.
// WHY:   providers must wrap both the dashboard and the auth pages.
// HOW:   a blocking inline script resolves the appearance class before first paint,
//        so the app never flashes light-on-dark. lang/dir are set by I18nProvider.
// WHERE: src/lib/appearance.tsx, src/lib/i18n.tsx, src/lib/auth-context.tsx

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { APPEARANCE_BOOT_SCRIPT } from "@/lib/appearance";

export const metadata: Metadata = {
  title: "Brandcast TV",
  description: "Cloud digital signage: pair any smart TV and publish in seconds.",
};

export const viewport: Viewport = {
  // Native chrome (scrollbars, form controls, selection) follows the appearance.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1c1e" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        {/* Pre-paint so there is no flash of the wrong appearance. */}
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-background font-sans text-body text-foreground antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
