import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { ToastProvider } from "@/components/ui/toast";
import { getOrgProfile } from "@/lib/api";

interface AppLayoutProps {
  children: ReactNode;
}

/**
 * Authenticated shell: sidebar + top bar (org name + autonomy switch).
 * The org profile seeds the header (org, owner, autonomy); pages fetch their
 * own data. In demo mode the api client returns its mock fallback so the shell
 * renders without a backend; otherwise a failure here bubbles to error.tsx.
 */
export default async function AppLayout({ children }: AppLayoutProps) {
  const org = await getOrgProfile();

  return (
    <ToastProvider>
      <AppShell
        orgName={org.orgName}
        ownerName={org.ownerName}
        autonomy={org.autonomy}
      >
        {children}
      </AppShell>
    </ToastProvider>
  );
}
