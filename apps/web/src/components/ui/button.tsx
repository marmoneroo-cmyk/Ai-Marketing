import {
  cloneElement,
  isValidElement,
} from "react";
import type {
  ButtonHTMLAttributes,
  ReactElement,
  ReactNode,
  Ref,
} from "react";
import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "success" | "danger";
type ButtonSize = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render the single child element with the button's styles (e.g. a Link). */
  asChild?: boolean;
  children: ReactNode;
  /** React 19 passes `ref` as a regular prop — no `forwardRef` needed. */
  ref?: Ref<HTMLButtonElement>;
}

const VARIANT_STYLES: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-600 text-white hover:bg-brand-700 focus-visible:outline-brand-600 shadow-sm shadow-brand-600/20",
  secondary:
    "bg-surface text-foreground border border-border hover:bg-surface-muted focus-visible:outline-ring",
  ghost:
    "bg-transparent text-muted hover:bg-surface-muted hover:text-foreground focus-visible:outline-ring",
  success:
    "bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:outline-emerald-600",
  danger:
    "bg-surface text-red-600 border border-red-200 hover:bg-red-50 focus-visible:outline-red-400 dark:text-red-400 dark:border-red-900 dark:hover:bg-red-950",
};

const SIZE_STYLES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
};

const BASE_STYLES =
  "inline-flex items-center justify-center rounded-xl font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0";

interface ChildWithClassName {
  className?: string;
}

export function Button({
  variant = "primary",
  size = "md",
  asChild = false,
  className,
  children,
  ref,
  ...props
}: ButtonProps) {
  const classes = cn(
    BASE_STYLES,
    VARIANT_STYLES[variant],
    SIZE_STYLES[size],
    className,
  );

  if (asChild && isValidElement(children)) {
    const child = children as ReactElement<ChildWithClassName>;
    return cloneElement(child, {
      className: cn(classes, child.props.className),
    });
  }

  return (
    <button ref={ref} className={classes} {...props}>
      {children}
    </button>
  );
}
