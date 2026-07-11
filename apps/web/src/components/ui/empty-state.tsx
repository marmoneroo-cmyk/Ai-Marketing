import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}

/** Consistent empty state shown when data is genuinely empty. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <Card
      className={cn(
        "animate-in flex flex-col items-center justify-center gap-3 px-6 py-16 text-center",
        className,
      )}
    >
      <span className="mb-1 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-surface text-brand-600 ring-1 ring-inset ring-brand-100 dark:text-brand-fg dark:ring-brand-900">
        {icon}
      </span>
      <p className="text-sm font-semibold tracking-tight text-foreground">
        {title}
      </p>
      <p className="max-w-sm text-sm leading-relaxed text-muted">
        {description}
      </p>
      {action ? <div className="mt-2">{action}</div> : null}
    </Card>
  );
}
