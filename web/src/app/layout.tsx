// SOT: root-layout, app-providers
// WHAT:  the single HTML shell; mounts i18n and auth for every route.
// WHY:   providers must wrap both the dashboard and the auth pages.
// HOW:   `dark` class opts into HeroUI's dark token set; lang/dir are set by I18nProvider.
// WHERE: providers live in src/lib/i18n.tsx and src/lib/auth-context.tsx

import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Brandcast TV",
  description: "Cloud digital signage: pair any smart TV and publish in seconds.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
