import { cn } from "@/lib/cn";

interface ScoreRingProps {
  label: string;
  value: number;
  accent: "brand" | "emerald" | "sky";
}

const ACCENT_STROKE: Record<ScoreRingProps["accent"], string> = {
  brand: "stroke-brand-500",
  emerald: "stroke-emerald-500",
  sky: "stroke-sky-500",
};

const ACCENT_TEXT: Record<ScoreRingProps["accent"], string> = {
  brand: "text-brand-700",
  emerald: "text-emerald-700",
  sky: "text-sky-700",
};

const RADIUS = 34;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ScoreRing({ label, value, accent }: ScoreRingProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const offset = CIRCUMFERENCE - (clamped / 100) * CIRCUMFERENCE;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative h-20 w-20 sm:h-24 sm:w-24">
        <svg viewBox="0 0 80 80" className="h-20 w-20 sm:h-24 sm:w-24 -rotate-90">
          <circle
            cx="40"
            cy="40"
            r={RADIUS}
            fill="none"
            strokeWidth="7"
            className="stroke-zinc-100 dark:stroke-zinc-800"
          />
          <circle
            cx="40"
            cy="40"
            r={RADIUS}
            fill="none"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            className={cn("transition-[stroke-dashoffset]", ACCENT_STROKE[accent])}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={cn("text-xl font-semibold tabular-nums", ACCENT_TEXT[accent])}>
            {clamped}
          </span>
        </div>
      </div>
      <span className="text-sm font-medium text-muted">{label}</span>
    </div>
  );
}
