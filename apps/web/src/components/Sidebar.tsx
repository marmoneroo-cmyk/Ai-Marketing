"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import type { ComponentType, SVGProps } from "react";
import { cn } from "@/lib/cn";
import {
  IconAnalytics,
  IconCalendar,
  IconCheck,
  IconContent,
  IconDashboard,
  IconInbox,
  IconLeads,
  IconRocket,
  IconSettings,
} from "@/components/icons";
import { getFocusableElements, trapTabFocus } from "@/lib/focus-trap";
import type { AppRoutes } from "@/lib/routes";
import type { AutonomyMode } from "@/lib/types";

export interface NavItem {
  label: string;
  href: AppRoutes;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

/** Exported so CommandPalette can reuse the exact same destinations — page
 *  navigation stays free and automatically in sync with the sidebar. */
export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: IconDashboard },
  { label: "Approvals", href: "/approvals", icon: IconCheck },
  { label: "Content", href: "/content", icon: IconContent },
  { label: "Calendar", href: "/calendar", icon: IconCalendar },
  { label: "Inbox", href: "/inbox", icon: IconInbox },
  { label: "Leads", href: "/leads", icon: IconLeads },
  { label: "Analytics", href: "/analytics", icon: IconAnalytics },
  { label: "Onboarding", href: "/onboarding", icon: IconRocket },
  { label: "Settings", href: "/settings", icon: IconSettings },
];

/**
 * Honest at-a-glance status for the sidebar card — reflects the org's ACTUAL
 * autonomy mode (replaces a hardcoded, always-"12 tasks" placeholder that also
 * falsely claimed "Autopilot is on" in observe/suggest modes).
 */
const AUTONOMY_CARD: Record<AutonomyMode, { title: string; body: string }> = {
  observe: {
    title: "Observe mode",
    body: "BrandPilot is learning your business. Switch to Suggest when you want it to start drafting.",
  },
  suggest: {
    title: "Suggestions on",
    body: "BrandPilot drafts posts and replies for your approval — review anything awaiting you on the dashboard.",
  },
  auto: {
    title: "Autopilot is on",
    body: "BrandPilot publishes and replies within your caps — review the moves it flags for you.",
  },
};

function BrandMark() {
  return (
    <Link
      href="/dashboard"
      className="flex items-center gap-2.5 rounded-lg px-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm shadow-brand-600/30">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
          <path
            d="M12 2.5l3 6.5 6.5 1-4.75 4.4L18 21l-6-3.4L6 21l1.25-6.6L2.5 10l6.5-1z"
            fill="currentColor"
          />
        </svg>
      </span>
      <span className="text-base font-semibold tracking-tight text-foreground">
        BrandPilot
      </span>
    </Link>
  );
}

interface NavContentProps {
  pathname: string;
  autonomy: AutonomyMode;
  onNavigate?: () => void;
}

function NavContent({ pathname, autonomy, onNavigate }: NavContentProps) {
  return (
    <>
      <BrandMark />

      <nav className="mt-7 flex flex-1 flex-col gap-1" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "interactive group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                active
                  ? "bg-brand-surface text-brand-700 dark:text-brand-fg"
                  : "text-muted hover:bg-surface-muted hover:text-foreground",
              )}
            >
              {/* Active-route accent rail — a clear, at-a-glance indicator. */}
              <span
                aria-hidden="true"
                className={cn(
                  "absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand-500 transition-opacity duration-150",
                  active ? "opacity-100" : "opacity-0",
                )}
              />
              <Icon
                className={cn(
                  "h-[18px] w-[18px] transition-colors duration-150",
                  active
                    ? "text-brand-600 dark:text-brand-fg"
                    : "text-subtle group-hover:text-foreground",
                )}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="rounded-2xl border border-brand-100 bg-brand-surface/60 p-4 dark:border-brand-900">
        <p className="text-xs font-semibold text-brand-800 dark:text-brand-fg">
          {AUTONOMY_CARD[autonomy].title}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-brand-700/80 dark:text-brand-200/80">
          {AUTONOMY_CARD[autonomy].body}
        </p>
      </div>
    </>
  );
}

/** Desktop sticky sidebar (>= lg). */
export function Sidebar({ autonomy }: { autonomy: AutonomyMode }) {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-border bg-surface/70 px-4 py-5 backdrop-blur lg:flex">
      <NavContent pathname={pathname} autonomy={autonomy} />
    </aside>
  );
}

interface SidebarDrawerProps {
  open: boolean;
  onClose: () => void;
  autonomy: AutonomyMode;
}

/** Mobile drawer (< lg), opened from the Topbar hamburger. */
export function SidebarDrawer({ open, onClose, autonomy }: SidebarDrawerProps) {
  const pathname = usePathname();
  const panelRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  // Read via a ref so the effect below only depends on `open` — onClose is a
  // fresh closure every render (AppShell doesn't memoize it), and keying the
  // effect on it too would re-run the focus-in/trap setup on any unrelated
  // parent re-render while the drawer is open, stealing focus back to the
  // first link mid-interaction.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // On open: remember the opener, move focus into the dialog, and trap Tab
  // within it. On close: restore focus to the opener. Escape-to-close and the
  // body scroll-lock are unchanged.
  useEffect(() => {
    if (!open) return;

    openerRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusable = getFocusableElements(panel);
    (focusable[0] ?? panel)?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key === "Tab") {
        trapTabFocus(event, panel);
      }
    }
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus();
    };
  }, [open]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-40 lg:hidden",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
      // `inert` (not just aria-hidden) so the off-screen drawer's nav links +
      // backdrop leave BOTH the tab order and the a11y tree while closed — a CSS
      // transform alone keeps them keyboard-reachable behind the page.
      inert={!open}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close menu"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-zinc-950/40 transition-opacity",
          open ? "opacity-100" : "opacity-0",
        )}
      />
      {/* Panel */}
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        tabIndex={-1}
        className={cn(
          "absolute left-0 top-0 flex h-full w-72 max-w-[85%] flex-col border-r border-border bg-surface px-4 py-5 shadow-xl transition-transform duration-200",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <NavContent pathname={pathname} autonomy={autonomy} onNavigate={onClose} />
      </aside>
    </div>
  );
}
