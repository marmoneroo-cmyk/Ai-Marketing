import { Badge } from "@/components/ui/badge";
import type { Platform } from "@/lib/types";
import { PLATFORM_LABEL, PLATFORM_DOT_COLOR } from "@/lib/platform";

interface PlatformBadgeProps {
  platform: Platform;
}

/** Small colored dot + label. Kept vendor-neutral (no external logo assets). */
export function PlatformBadge({ platform }: PlatformBadgeProps) {
  return (
    <Badge tone="neutral">
      <span
        className={`h-1.5 w-1.5 rounded-full ${PLATFORM_DOT_COLOR[platform]}`}
      />
      {PLATFORM_LABEL[platform]}
    </Badge>
  );
}
