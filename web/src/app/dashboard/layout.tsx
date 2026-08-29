// SOT: dashboard-layout
// WHAT:  wraps every /dashboard route in the authenticated shell.
// WHY:   one guard point for auth, permissions and plan gating.
// HOW:   the shell is a client component; this stays a thin server boundary.
// WHERE: src/components/global/dashboard-shell.tsx

import type { ReactNode } from "react";
import { DashboardShell } from "@/components/global/dashboard-shell";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>;
}
