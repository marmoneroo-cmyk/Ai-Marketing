"use client";

import { useRouter } from "next/navigation";
import { AutonomySwitch } from "@/components/AutonomySwitch";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { IconLogout, IconMenu } from "@/components/icons";
import { logout } from "@/lib/api";
import type { AutonomyMode } from "@/lib/types";

interface TopbarProps {
  orgName: string;
  ownerName: string;
  autonomy: AutonomyMode;
  onMenuClick: () => void;
}

export function Topbar({
  orgName,
  ownerName,
  autonomy,
  onMenuClick,
}: TopbarProps) {
  const router = useRouter();
  const initials = ownerName
    .split(" ")
    .map((part) => part[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();

  function handleLogout() {
    logout();
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-surface/70 px-4 backdrop-blur sm:px-5 lg:px-8">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open navigation menu"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:hidden"
        >
          <IconMenu className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-foreground">
            {orgName}
          </p>
          <p className="hidden text-xs text-muted sm:block">
            Daily summary ·{" "}
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <div className="hidden items-center gap-2 md:flex">
          <span className="text-xs font-medium text-subtle">Autonomy</span>
          <AutonomySwitch initial={autonomy} />
        </div>

        <ThemeToggle />

        <div className="hidden h-6 w-px bg-border sm:block" />

        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700 dark:bg-brand-900 dark:text-brand-200">
            {initials}
          </span>
          <span className="hidden text-sm font-medium text-foreground lg:block">
            {ownerName}
          </span>
        </div>

        <button
          type="button"
          onClick={handleLogout}
          aria-label="Sign out"
          className="flex h-9 w-9 items-center justify-center rounded-xl text-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <IconLogout className="h-[18px] w-[18px]" />
        </button>
      </div>
    </header>
  );
}
