"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { generateContentPlan } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

/** The four owner-facing content formats the picker offers (title-cased for display). */
const FORMAT_OPTIONS = ["post", "carousel", "story", "reel"] as const;

const QUEUED_STATUS_TEXT = "Queued — new drafts will appear shortly";

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Client action for the Content page (a server component): enqueues an on-demand
 * weekly content-generation job, toasts success/failure, and refreshes the route
 * so newly drafted items appear once the worker completes.
 *
 * Clicking the button opens an inline panel of toggleable format chips so the
 * owner can optionally narrow which formats the AI should produce this week.
 * Leaving every chip unselected keeps today's exact behavior — the model
 * decides — since `formats` is only sent when at least one chip is selected.
 */
export function GenerateContentButton() {
  const [generating, setGenerating] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedFormats, setSelectedFormats] = useState<string[]>([]);
  const [queued, setQueued] = useState(false);
  const { notify } = useToast();
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // Set right before closing the panel so a `useEffect` can return focus to the
  // trigger only after React has committed the panel's removal from the DOM —
  // focusing synchronously in the same tick loses to the currently-focused
  // panel button being unmounted, which resets focus to <body>.
  const [pendingFocusReturn, setPendingFocusReturn] = useState(false);

  useEffect(() => {
    if (!pickerOpen && pendingFocusReturn) {
      triggerRef.current?.focus();
      setPendingFocusReturn(false);
    }
  }, [pickerOpen, pendingFocusReturn]);

  function toggleFormat(format: string) {
    setSelectedFormats((current) =>
      current.includes(format)
        ? current.filter((f) => f !== format)
        : [...current, format],
    );
  }

  function closePicker() {
    setPickerOpen(false);
    setPendingFocusReturn(true);
  }

  function togglePicker() {
    setPickerOpen((open) => {
      const next = !open;
      if (next) {
        // Re-opening: clear any status left over from a previous generate.
        setQueued(false);
      } else {
        setPendingFocusReturn(true);
      }
      return next;
    });
  }

  async function handleGenerate() {
    if (generating) return;
    setGenerating(true);
    try {
      await generateContentPlan(
        selectedFormats.length > 0 ? selectedFormats : undefined,
      );
      notify("Generating this week's content. New drafts will appear shortly.", "success");
      setSelectedFormats([]);
      setQueued(true);
      closePicker();
      router.refresh();
    } catch (error: unknown) {
      notify(
        error instanceof Error ? error.message : "Couldn't start content generation.",
        "error",
      );
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        ref={triggerRef}
        size="sm"
        aria-expanded={pickerOpen}
        aria-controls="format-picker-panel"
        onClick={togglePicker}
        disabled={generating}
      >
        {generating ? "Generating…" : "Generate this week's content"}
      </Button>

      {pickerOpen && (
        <div
          id="format-picker-panel"
          role="group"
          aria-label="Content formats"
          aria-describedby="format-picker-hint"
          className="flex w-full max-w-xs flex-col gap-2 rounded-xl border border-border bg-surface p-3 shadow-sm"
        >
          <div className="flex flex-wrap justify-end gap-1.5">
            {FORMAT_OPTIONS.map((format) => {
              const selected = selectedFormats.includes(format);
              return (
                <button
                  key={format}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleFormat(format)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    selected
                      ? "border-brand-600 bg-brand-600 text-white"
                      : "border-border bg-surface text-foreground hover:bg-surface-muted",
                  )}
                >
                  {titleCase(format)}
                </button>
              );
            })}
          </div>
          <p id="format-picker-hint" className="text-right text-xs text-muted">
            Leave empty to let BrandPilot decide
          </p>
          <Button
            size="sm"
            onClick={() => void handleGenerate()}
            disabled={generating}
          >
            {generating ? "Generating…" : "Generate"}
          </Button>
        </div>
      )}

      {queued && (
        <div
          role="status"
          aria-live="polite"
          className="flex w-full max-w-xs items-center justify-between gap-2 rounded-lg bg-surface-muted/60 px-3 py-1.5 text-xs text-muted"
        >
          <span>✓ {QUEUED_STATUS_TEXT}</span>
          <button
            type="button"
            onClick={() => setQueued(false)}
            aria-label="Dismiss status"
            className="shrink-0 rounded-md opacity-60 transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
          >
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
