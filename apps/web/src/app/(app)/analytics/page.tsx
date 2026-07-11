import type { Metadata } from "next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PlatformBadge } from "@/components/platform-badge";
import { IconAnalytics } from "@/components/icons";
import { getAnalytics } from "@/lib/api";
import { formatCompactNumber, formatCurrency } from "@/lib/format";
import type { KpiPoint } from "@/lib/types";

export const metadata: Metadata = { title: "Analytics" };

type Metric = "reach" | "engagement" | "leads" | "revenue";

interface Sparkline {
  points: string;
  last: number;
  delta: number;
}

/** Build an SVG polyline (0..100 x 0..32 viewbox) plus a first→last delta. */
function sparkline(series: KpiPoint[], metric: Metric): Sparkline {
  const values = series.map((p) => p[metric]);
  if (values.length === 0) return { points: "", last: 0, delta: 0 };

  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const stepX = values.length > 1 ? 100 / (values.length - 1) : 0;

  const points = values
    .map((v, i) => {
      const x = (i * stepX).toFixed(2);
      const y = (32 - ((v - min) / span) * 30 - 1).toFixed(2);
      return `${x},${y}`;
    })
    .join(" ");

  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  const delta = first ? Math.round(((last - first) / first) * 1000) / 10 : 0;
  return { points, last, delta };
}

interface TrendTileProps {
  label: string;
  spark: Sparkline;
  format: "compact" | "currency";
  stroke: string;
}

function TrendTile({ label, spark, format, stroke }: TrendTileProps) {
  const value =
    format === "currency"
      ? formatCurrency(spark.last)
      : formatCompactNumber(spark.last);
  const up = spark.delta >= 0;

  return (
    <Card interactive className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted">{label}</span>
        <span
          className={
            up
              ? "text-xs font-medium text-emerald-600 dark:text-emerald-400"
              : "text-xs font-medium text-red-500 dark:text-red-400"
          }
        >
          {up ? "+" : ""}
          {spark.delta}%
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
        {value}
      </p>
      <svg
        viewBox="0 0 100 32"
        preserveAspectRatio="none"
        className="mt-3 h-10 w-full"
        aria-hidden="true"
      >
        {spark.points ? (
          <polyline
            points={spark.points}
            fill="none"
            stroke="currentColor"
            className={stroke}
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
    </Card>
  );
}

export default async function AnalyticsPage() {
  const { series, topPosts } = await getAnalytics();

  const reach = sparkline(series, "reach");
  const engagement = sparkline(series, "engagement");
  const leads = sparkline(series, "leads");
  const revenue = sparkline(series, "revenue");
  const maxEngagement = Math.max(1, ...topPosts.map((p) => p.engagement));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Analytics
        </h1>
        <p className="mt-1 text-sm text-muted">
          Reach, engagement, leads, and revenue — rolled up daily, with your
          top-performing posts.
        </p>
      </div>

      {series.length === 0 ? (
        <EmptyState
          icon={<IconAnalytics className="h-6 w-6" />}
          title="No analytics yet"
          description="Once your first posts publish, BrandPilot rolls up daily KPIs and surfaces your top-performing content here."
        />
      ) : (
        <>
          <section className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <TrendTile
              label="Reach (30d)"
              spark={reach}
              format="compact"
              stroke="text-brand-500"
            />
            <TrendTile
              label="Engagement (30d)"
              spark={engagement}
              format="compact"
              stroke="text-sky-500"
            />
            <TrendTile
              label="Leads (30d)"
              spark={leads}
              format="compact"
              stroke="text-emerald-500"
            />
            <TrendTile
              label="Revenue (30d)"
              spark={revenue}
              format="currency"
              stroke="text-amber-500"
            />
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Top posts</CardTitle>
              <span className="text-xs font-medium text-subtle">
                by engagement
              </span>
            </CardHeader>
            <CardContent>
              {topPosts.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">
                  No post metrics captured yet.
                </p>
              ) : (
                <ul className="space-y-3">
                  {topPosts.map((post) => {
                    const pct = Math.round(
                      (post.engagement / maxEngagement) * 100,
                    );
                    return (
                      <li
                        key={post.id}
                        className="rounded-xl border border-border bg-surface-muted/60 p-3.5"
                      >
                        <div className="flex items-center gap-2">
                          <PlatformBadge platform={post.platform} />
                          <span className="ml-auto text-xs font-medium text-muted">
                            {formatCompactNumber(post.reach)} reach
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-3">
                          <div
                            role="progressbar"
                            aria-valuenow={pct}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`Engagement relative to top post: ${pct}%`}
                            className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted dark:bg-zinc-800"
                          >
                            <div
                              className="h-full rounded-full bg-brand-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">
                            {formatCompactNumber(post.engagement)}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
