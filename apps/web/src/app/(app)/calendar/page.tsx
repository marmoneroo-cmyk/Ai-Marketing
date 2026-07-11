import type { Metadata } from "next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PlatformBadge } from "@/components/platform-badge";
import { IconCalendar } from "@/components/icons";
import { Pager } from "@/components/ui/pager";
import { getCalendar } from "@/lib/api";
import {
  parsePageParam,
  redirectIfPageOutOfRange,
  type PageSearchParams,
} from "@/lib/pagination";
import { dayKey, formatDayLabel, formatTime } from "@/lib/format";
import type { CalendarEntry } from "@/lib/types";

export const metadata: Metadata = { title: "Calendar" };

const STATUS_TONE: Record<string, "info" | "success" | "warning" | "danger" | "neutral"> =
  {
    scheduled: "info",
    publishing: "warning",
    published: "success",
    failed: "danger",
    paused: "neutral",
    canceled: "neutral",
  };

function statusTone(
  status: string,
): "info" | "success" | "warning" | "danger" | "neutral" {
  return STATUS_TONE[status] ?? "neutral";
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}

interface DayGroup {
  key: string;
  label: string;
  entries: CalendarEntry[];
}

/** Group upcoming entries into ordered day buckets (input is already sorted). */
function groupByDay(entries: CalendarEntry[]): DayGroup[] {
  const groups: DayGroup[] = [];
  const index = new Map<string, DayGroup>();

  for (const entry of entries) {
    const key = dayKey(entry.scheduledFor);
    const existing = index.get(key);
    if (existing) {
      existing.entries.push(entry);
    } else {
      const group: DayGroup = {
        key,
        label: formatDayLabel(entry.scheduledFor),
        entries: [entry],
      };
      index.set(key, group);
      groups.push(group);
    }
  }
  return groups;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  const { page: pageParam } = await searchParams;
  const { items: entries, total, page, limit } = await getCalendar(
    parsePageParam(pageParam),
  );
  redirectIfPageOutOfRange("/calendar", page, limit, total, entries.length);
  const groups = groupByDay(entries);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Calendar
        </h1>
        <p className="mt-1 text-sm text-muted">
          Everything BrandPilot has queued to publish, grouped by day.
        </p>
      </div>

      {total === 0 ? (
        <EmptyState
          icon={<IconCalendar className="h-6 w-6" />}
          title="Nothing scheduled"
          description="Approve content from the dashboard and it will show up here on its scheduled publish day."
        />
      ) : (
        <div className="stagger space-y-6">
          {groups.map((group) => (
            <Card key={group.key}>
              <CardHeader>
                <CardTitle>{group.label}</CardTitle>
                <Badge tone="neutral">
                  {group.entries.length}
                  {group.entries.length === 1 ? " post" : " posts"}
                </Badge>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {group.entries.map((entry) => (
                    <li
                      key={entry.id}
                      className="interactive flex items-start gap-4 rounded-xl border border-border bg-surface-muted/60 p-3.5 hover:border-border-strong hover:bg-surface-muted"
                    >
                      <div className="w-16 shrink-0 pt-0.5 text-sm font-medium tabular-nums text-muted">
                        {formatTime(entry.scheduledFor)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <PlatformBadge platform={entry.platform} />
                          {entry.format ? (
                            <Badge tone="neutral">{titleCase(entry.format)}</Badge>
                          ) : null}
                          <Badge tone={statusTone(entry.status)}>
                            {titleCase(entry.status)}
                          </Badge>
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-muted">
                          {entry.caption || "No caption yet."}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Pager page={page} limit={limit} total={total} basePath="/calendar" />
    </div>
  );
}
