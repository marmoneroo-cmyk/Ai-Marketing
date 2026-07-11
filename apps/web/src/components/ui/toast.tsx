"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type ToastTone = "success" | "error" | "info";

/** An inline action rendered inside a toast (e.g. "Undo"). */
interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
  action?: ToastAction;
}

interface ToastContextValue {
  notify: (message: string, tone?: ToastTone, action?: ToastAction) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 4500;
/**
 * A toast carrying an actionable Undo (or similar) button stays up longer —
 * it needs a real window for the human to notice and click it, not just read
 * the message.
 */
const AUTO_DISMISS_WITH_ACTION_MS = 8000;

const TONE_STYLES: Record<ToastTone, string> = {
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  error:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
  info: "border-border bg-surface text-foreground",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, tone: ToastTone = "info", action?: ToastAction) => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { id, tone, message, ...(action ? { action } : {}) }]);
      setTimeout(
        () => dismiss(id),
        action ? AUTO_DISMISS_WITH_ACTION_MS : AUTO_DISMISS_MS,
      );
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(() => ({ notify }), [notify]);

  const renderToast = (toast: Toast) => (
    <div
      key={toast.id}
      className={cn(
        "pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg shadow-zinc-900/10",
        TONE_STYLES[toast.tone],
      )}
    >
      <span className="flex-1">{toast.message}</span>
      {toast.action ? (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            dismiss(toast.id);
          }}
          className="shrink-0 rounded-md text-sm font-semibold underline underline-offset-2 opacity-90 transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        aria-label="Dismiss notification"
        className="shrink-0 rounded-md opacity-60 transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
          <path
            d="M5 5l10 10M15 5L5 15"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2">
        {/* Two persistent live regions: errors announce ASSERTIVELY (interrupt the
            screen reader), success/info POLITELY. Persistent (not per-toast) so
            inserted messages are reliably picked up. */}
        <div aria-live="assertive" aria-atomic="false" className="flex flex-col gap-2">
          {toasts.filter((t) => t.tone === "error").map(renderToast)}
        </div>
        <div aria-live="polite" aria-atomic="false" className="flex flex-col gap-2">
          {toasts.filter((t) => t.tone !== "error").map(renderToast)}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
