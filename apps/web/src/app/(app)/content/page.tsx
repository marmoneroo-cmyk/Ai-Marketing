import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PlatformBadge } from "@/components/platform-badge";
import { VoiceScoreBadge } from "@/components/voice-score-badge";
import { VariantReviewActions } from "@/components/VariantReviewActions";
import { VariantCaption } from "@/components/VariantCaption";
import { ContentMediaPreview } from "@/components/ContentMediaPreview";
import { GenerateContentButton } from "@/components/GenerateContentButton";
import { Pager } from "@/components/ui/pager";
import { IconContent } from "@/components/icons";
import { getContent } from "@/lib/api";
import {
  parsePageParam,
  redirectIfPageOutOfRange,
  type PageSearchParams,
} from "@/lib/pagination";
import { formatDateTime } from "@/lib/format";
import { PLATFORM_LABEL } from "@/lib/platform";
import type { ContentStatus } from "@/lib/types";

export const metadata: Metadata = { title: "Content" };

const STATUS_TONE: Record<
  ContentStatus,
  "neutral" | "brand" | "success" | "warning" | "danger" | "info"
> = {
  draft: "neutral",
  scheduled: "info",
  needs_approval: "warning",
  published: "success",
  failed: "danger",
};

const STATUS_LABEL: Record<ContentStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  needs_approval: "Needs approval",
  published: "Published",
  failed: "Failed",
};

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  const { page: pageParam } = await searchParams;
  const { items, total, page, limit } = await getContent(parsePageParam(pageParam));
  redirectIfPageOutOfRange("/content", page, limit, total, items.length);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Content
          </h1>
          <p className="mt-1 text-sm text-muted">
            Upcoming posts across your channels, drafted and scheduled by
            BrandPilot.
          </p>
        </div>
        <GenerateContentButton />
      </div>

      {total === 0 ? (
        <EmptyState
          icon={<IconContent className="h-6 w-6" />}
          title="No content yet"
          description="Once your channels are connected, BrandPilot drafts and schedules posts for you. New drafts and scheduled posts will appear here."
          action={
            <Button asChild>
              <Link href="/onboarding">Set up your channels</Link>
            </Button>
          }
        />
      ) : (
        <ul className="stagger space-y-4">
          {items.map((item) => (
            <li key={item.id}>
              <Card className="overflow-hidden">
                {/* Item header */}
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-surface-muted/40 px-5 py-4">
                  <div className="flex min-w-0 items-start gap-3">
                    {item.media ? (
                      <ContentMediaPreview media={item.media} className="mt-0.5" />
                    ) : null}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {item.title}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted">
                        {item.caption}
                      </p>
                      <p className="mt-1 text-xs text-subtle">
                        {formatDateTime(item.scheduledFor)}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <PlatformBadge platform={item.platform} />
                    <Badge tone="neutral">{titleCase(item.format)}</Badge>
                    <Badge tone={STATUS_TONE[item.status]}>
                      {STATUS_LABEL[item.status]}
                    </Badge>
                  </div>
                </div>

                {/* Per-platform variants */}
                {item.variants.length === 0 ? (
                  <p className="px-5 py-4 text-xs text-muted">
                    No platform variants generated yet.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {item.variants.map((variant) => (
                      <li
                        key={variant.id}
                        className="interactive-row flex flex-wrap items-start justify-between gap-3 px-5 py-4 hover:bg-surface-muted/40"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <PlatformBadge platform={variant.platform} />
                            <VoiceScoreBadge score={variant.voiceScore} />
                          </div>
                          <VariantCaption
                            variantId={variant.id}
                            initialCaption={variant.caption}
                            fallback={variant.hook}
                            platformLabel={PLATFORM_LABEL[variant.platform]}
                          />
                        </div>
                        <div className="shrink-0 self-center">
                          <VariantReviewActions
                            approvalId={item.approvalId}
                            variantId={variant.id}
                            canSchedule={variant.status === "scheduled"}
                            platformLabel={PLATFORM_LABEL[variant.platform]}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Pager page={page} limit={limit} total={total} basePath="/content" />
    </div>
  );
}
