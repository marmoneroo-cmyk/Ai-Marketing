"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, KeyboardEvent as ReactKeyboardEvent, SVGProps } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { getFocusableElements, trapTabFocus } from "@/lib/focus-trap";
import { NAV_ITEMS } from "@/components/Sidebar";
import { IconCheck, IconSettings } from "@/components/icons";
import type { AppRoutes } from "@/lib/routes";

interface PaletteCommand {
  id: string;
  label: string;
  href: AppRoutes;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
}

/**
 * A few global actions beyond the sidebar's own pages. Kept intentionally
 * small and navigation-only (no data mutations) — each just lands the user
 * on the page where the real action lives.
 */
const EXTRA_COMMANDS: PaletteCommand[] = [
  { id: "invite-member", label: "Invite a member", href: "/settings", icon: IconSettings },
  { id: "review-approvals", label: "Review approvals", href: "/approvals", icon: IconCheck },
];

/**
 * Every sidebar destination phrased as a "Go to <page>" command, plus the
 * extras above. Built from NAV_ITEMS so this list can never drift out of
 * sync with the sidebar — add a page there and it appears here for free.
 */
const ALL_COMMANDS: PaletteCommand[] = [
  ...NAV_ITEMS.map((item) => ({
    id: `nav-${item.href}`,
    label: `Go to ${item.label}`,
    href: item.href,
    icon: item.icon,
  })),
  ...EXTRA_COMMANDS,
];

// Focus-trap + focusable-element helpers now live in `@/lib/focus-trap`,
// shared with SidebarDrawer (was duplicated verbatim in both).

function optionId(id: string): string {
  return `command-palette-option-${id}`;
}

const LISTBOX_ID = "command-palette-listbox";

/**
 * Global command palette (Cmd/Ctrl+K) — jump to any sidebar page or a small
 * set of safe, pure-navigation actions without leaving the keyboard.
 *
 * Mounted once in AppShell so the shortcut listens globally regardless of
 * what currently has focus. Open/close focus management (capture opener ->
 * focus panel -> trap Tab -> restore on close -> Escape to close) mirrors
 * SidebarDrawer's mobile-nav pattern in Sidebar.tsx.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return ALL_COMMANDS;
    return ALL_COMMANDS.filter((command) =>
      command.label.toLowerCase().includes(normalized),
    );
  }, [query]);

  const activeCommand = filtered[activeIndex];

  function close() {
    setOpen(false);
  }

  function selectCommand(command: PaletteCommand) {
    router.push(command.href);
    close();
  }

  // Global shortcut: Cmd/Ctrl+K opens the palette from anywhere in the app.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Each time the palette opens, start from a clean search — a stale query
  // from the previous session should never linger.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  // On open: remember the opener, focus the input, and trap Tab within the
  // dialog. On close: restore focus to the opener. Escape closes. Mirrors
  // SidebarDrawer's open/close focus management in Sidebar.tsx.
  useEffect(() => {
    if (!open) return;

    openerRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key === "Tab") {
        trapTabFocus(event, panelRef.current);
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

  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (filtered.length === 0) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % filtered.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + filtered.length) % filtered.length);
        break;
      case "Enter":
        event.preventDefault();
        if (activeCommand) selectCommand(activeCommand);
        break;
      default:
        break;
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close command menu"
        onClick={close}
        className={cn("animate-fade absolute inset-0 bg-zinc-950/40")}
      />
      {/* Panel */}
      <div className="pointer-events-none fixed inset-0 flex items-start justify-center px-4 pt-24 sm:pt-32">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Command menu"
          className={cn(
            "animate-in pointer-events-auto w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl shadow-zinc-950/20",
          )}
        >
          <div className="flex items-center gap-2.5 border-b border-border px-4">
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 shrink-0 text-subtle"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.75" />
              <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={LISTBOX_ID}
              aria-activedescendant={activeCommand ? optionId(activeCommand.id) : undefined}
              aria-autocomplete="list"
              aria-label="Search commands"
              autoComplete="off"
              spellCheck={false}
              placeholder="Type a command or search…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleInputKeyDown}
              className="w-full bg-transparent py-3.5 text-sm text-foreground outline-none placeholder:text-subtle"
            />
          </div>

          {filtered.length > 0 ? (
            <ul
              id={LISTBOX_ID}
              role="listbox"
              aria-label="Commands"
              className="scroll-slim max-h-80 overflow-y-auto p-2"
            >
              {filtered.map((command, index) => {
                const active = index === activeIndex;
                const Icon = command.icon;
                return (
                  <li
                    key={command.id}
                    id={optionId(command.id)}
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectCommand(command)}
                    className={cn(
                      "interactive-row flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium",
                      active
                        ? "bg-brand-surface text-brand-700 dark:text-brand-fg"
                        : "text-foreground hover:bg-surface-muted",
                    )}
                  >
                    {Icon ? <Icon className="h-4 w-4 shrink-0 text-subtle" /> : null}
                    {command.label}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-subtle">
              No commands found
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
