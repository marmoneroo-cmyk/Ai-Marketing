import type { InputHTMLAttributes, ReactNode } from "react";
import { useId } from "react";
import { cn } from "@/lib/cn";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: string;
  error?: string;
}

/**
 * Shared labelled text input. Wires label/description/error to the field via
 * generated ids for accessibility, and uses semantic tokens so it themes with
 * the app (light + dark).
 */
export function Input({
  label,
  hint,
  error,
  id,
  className,
  ...props
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="w-full">
      {label ? (
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-foreground"
        >
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "block w-full rounded-xl border bg-surface px-3.5 py-2.5 text-sm text-foreground shadow-sm outline-none transition-colors",
          "placeholder:text-subtle",
          "focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:focus:ring-brand-900",
          error
            ? "border-red-300 dark:border-red-800"
            : "border-border",
          label ? "mt-1.5" : undefined,
          className,
        )}
        {...props}
      />
      {hint && !error ? (
        <p id={hintId} className="mt-1.5 text-xs text-subtle">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
