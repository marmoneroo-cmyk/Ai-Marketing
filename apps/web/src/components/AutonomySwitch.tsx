"use client";

import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { setAutonomy } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import type { AutonomyMode } from "@/lib/types";

const MODES: Array<{ value: AutonomyMode; label: string; hint: string }> = [
  { value: "observe", label: "Observe", hint: "Watch only" },
  { value: "suggest", label: "Suggest", hint: "Ask before acting" },
  { value: "auto", label: "Auto", hint: "Act within caps" },
];

interface AutonomySwitchProps {
  initial?: AutonomyMode;
  onChange?: (mode: AutonomyMode) => void;
}

/**
 * Single-select autonomy control implemented as an accessible tablist:
 * roving tabIndex (only the active tab is tabbable) plus Left/Right/Home/End
 * arrow-key navigation. Changes are optimistic and roll back with a toast if
 * the API rejects them.
 */
export function AutonomySwitch({ initial = "suggest", onChange }: AutonomySwitchProps) {
  const [mode, setMode] = useState<AutonomyMode>(initial);
  const [saving, setSaving] = useState(false);
  const { notify } = useToast();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  async function commit(next: AutonomyMode) {
    if (next === mode || saving) return;
    const previous = mode;
    setMode(next); // optimistic
    setSaving(true);
    try {
      await setAutonomy(next);
      onChange?.(next);
    } catch (error: unknown) {
      setMode(previous); // roll back
      notify(
        error instanceof Error
          ? error.message
          : "Couldn't update autonomy mode.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  function focusTab(index: number) {
    const clamped = (index + MODES.length) % MODES.length;
    tabRefs.current[clamped]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        focusTab(index + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        focusTab(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusTab(0);
        break;
      case "End":
        event.preventDefault();
        focusTab(MODES.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <div
      role="tablist"
      aria-label="Autonomy mode"
      className="inline-flex items-center gap-0.5 rounded-xl border border-border bg-surface-muted p-0.5"
    >
      {MODES.map((m, index) => {
        const active = m.value === mode;
        return (
          <button
            key={m.value}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`autonomy-tab-${m.value}`}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            title={m.hint}
            disabled={saving}
            onClick={() => void commit(m.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              "disabled:cursor-not-allowed disabled:opacity-70",
              active
                ? "bg-surface text-brand-700 shadow-sm ring-1 ring-border dark:text-brand-fg"
                : "text-subtle hover:text-foreground",
            )}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
