import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Opt into the shared hover lift (border + shadow + 1px rise). */
  interactive?: boolean;
}

export function Card({
  className,
  children,
  interactive = false,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-surface shadow-sm shadow-zinc-900/[0.03] dark:shadow-black/20",
        interactive && "interactive-card",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface CardSectionProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function CardHeader({ className, children, ...props }: CardSectionProps) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 px-5 pt-5 pb-3",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardTitle({ className, children, ...props }: CardSectionProps) {
  return (
    <h3
      className={cn(
        "text-sm font-semibold tracking-tight text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </h3>
  );
}

export function CardContent({ className, children, ...props }: CardSectionProps) {
  return (
    <div className={cn("px-5 pb-5", className)} {...props}>
      {children}
    </div>
  );
}
