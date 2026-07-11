"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { updateVariant } from "@/lib/api";

interface VariantCaptionProps {
  variantId: string;
  initialCaption: string;
  /** Shown when the caption is empty (the AI's hook line). */
  fallback?: string;
  /**
   * Platform label, threaded into the Edit/Save/Cancel accessible names so
   * they're distinguishable when a content item has multiple platform
   * variants on screen at once (mirrors `VariantReviewActions`).
   */
  platformLabel: string;
}

/** Hard ceiling on caption length, mirrored by the textarea's `maxLength`. */
const CAPTION_MAX_LENGTH = 5000;

/** Counter only appears once typing gets close to the ceiling (80%+). */
const CAPTION_COUNTER_THRESHOLD = CAPTION_MAX_LENGTH * 0.8;

/**
 * A variant's caption with inline editing. Shows the (line-clamped) caption + an
 * Edit control; editing swaps in a textarea with Save / Cancel. On save the edit
 * is persisted via `updateVariant` and the displayed caption updates locally (the
 * Content page is a server component, so this client island owns the caption
 * state). The publish worker reads the variant at publish time, so editing a
 * not-yet-published variant is exactly what goes out — the owner can refine the
 * AI's draft before it publishes.
 */
export function VariantCaption({
  variantId,
  initialCaption,
  fallback,
  platformLabel,
}: VariantCaptionProps) {
  const [caption, setCaption] = useState(initialCaption);
  const [draft, setDraft] = useState(initialCaption);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const { notify } = useToast();

  function startEdit() {
    setDraft(caption);
    setEditing(true);
  }

  async function save() {
    if (saving) return;
    const next = draft.trim();
    if (!next) {
      notify("Caption can't be empty.", "error");
      return;
    }
    setSaving(true);
    try {
      const result = await updateVariant(variantId, { caption: next });
      setCaption(result.caption);
      setEditing(false);
      notify("Caption updated.", "success");
    } catch (error: unknown) {
      notify(
        error instanceof Error ? error.message : "Couldn't save your edit. Please try again.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    const nearLimit = draft.length > CAPTION_COUNTER_THRESHOLD;
    return (
      <div className="mt-2">
        <label htmlFor={`cap-${variantId}`} className="sr-only">
          Edit {platformLabel} caption
        </label>
        <textarea
          id={`cap-${variantId}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          autoFocus
          maxLength={CAPTION_MAX_LENGTH}
          className="block w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm leading-relaxed text-foreground shadow-sm outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-900"
        />
        {nearLimit ? (
          <p className="mt-1 text-right text-xs text-muted">
            {draft.length.toLocaleString()} / {CAPTION_MAX_LENGTH.toLocaleString()}
          </p>
        ) : null}
        <div className="mt-2 flex items-center gap-2">
          <Button
            size="sm"
            disabled={saving}
            aria-label={`Save ${platformLabel} caption`}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={saving}
            aria-label={`Cancel editing ${platformLabel} caption`}
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 flex items-start justify-between gap-3">
      <p className="line-clamp-3 text-sm text-foreground">
        {caption || fallback || "No caption yet."}
      </p>
      <button
        type="button"
        onClick={startEdit}
        aria-label={`Edit ${platformLabel} caption`}
        className="shrink-0 text-xs font-medium text-brand-600 transition-colors hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:text-brand-fg"
      >
        Edit
      </button>
    </div>
  );
}
