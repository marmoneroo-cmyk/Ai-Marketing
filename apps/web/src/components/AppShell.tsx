"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Sidebar, SidebarDrawer } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { CommandPalette } from "@/components/CommandPalette";
import type { AutonomyMode } from "@/lib/types";

interface AppShellProps {
  orgName: string;
  ownerName: string;
  autonomy: AutonomyMode;
  children: ReactNode;
}

/**
 * Authenticated shell chrome: desktop sidebar + mobile drawer + top bar.
 * Owns the mobile drawer open state and exposes the hamburger via the Topbar.
 * The main content region carries the id targeted by the skip link.
 */
export function AppShell({
  orgName,
  ownerName,
  autonomy,
  children,
}: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="app-canvas flex min-h-dvh">
      <Sidebar autonomy={autonomy} />
      <SidebarDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} autonomy={autonomy} />
      <CommandPalette />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          orgName={orgName}
          ownerName={ownerName}
          autonomy={autonomy}
          onMenuClick={() => setDrawerOpen(true)}
        />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 px-4 py-6 sm:px-5 lg:px-8 lg:py-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
