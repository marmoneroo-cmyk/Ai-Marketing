import { cn } from "@/lib/cn";
import type { ContentMedia } from "@/lib/types";

const ASPECT_CLASS: Record<NonNullable<ContentMedia["aspect"]>, string> = {
  portrait: "aspect-[4/5]",
  square: "aspect-square",
  landscape: "aspect-[16/9]",
};

interface ContentMediaPreviewProps {
  media: ContentMedia;
  className?: string;
}

/**
 * Thumbnail of a content item's AI-generated visual. Renders the image, or a
 * video/reel poster with a play affordance. Surfacing the actual generated
 * asset — not just the caption — is what makes the content screen a real
 * preview of what will be posted.
 *
 * Uses a plain <img>: the source is a `data:` URI in the demo and a served
 * asset URL in production, neither of which `next/image` can optimize here.
 */
export function ContentMediaPreview({ media, className }: ContentMediaPreviewProps) {
  const aspect = ASPECT_CLASS[media.aspect ?? "square"];
  const isVideo = media.kind === "video";

  return (
    <div
      className={cn(
        "relative w-24 shrink-0 overflow-hidden rounded-lg border border-border bg-surface-muted sm:w-28",
        aspect,
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={media.url} alt={media.alt} loading="lazy" className="h-full w-full object-cover" />
      {isVideo ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center bg-black/15"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white shadow-sm">
            <svg viewBox="0 0 24 24" className="h-4 w-4 translate-x-px" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </span>
      ) : null}
    </div>
  );
}
