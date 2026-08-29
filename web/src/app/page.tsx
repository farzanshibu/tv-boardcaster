// SOT: root-redirect
// WHAT:  sends visitors to the dashboard, which bounces to /login when signed out.
// WHY:   the product has no marketing page; the console is the product.
// HOW:   server redirect, so there is no flash of an empty client shell.
// WHERE: guard lives in src/components/global/dashboard-shell.tsx

import { redirect } from "next/navigation";

export default function Home() {
  redirect("/dashboard");
}
