import type { Metadata } from "next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/ui/stat-tile";
import { EmptyState } from "@/components/ui/empty-state";
import { IconLeads } from "@/components/icons";
import { Pager } from "@/components/ui/pager";
import { getLeads, getLeadSummary } from "@/lib/api";
import {
  parsePageParam,
  redirectIfPageOutOfRange,
  type PageSearchParams,
} from "@/lib/pagination";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Lead } from "@/lib/types";

export const metadata: Metadata = { title: "Leads" };

const STATUS_TONE: Record<
  string,
  "success" | "warning" | "info" | "brand" | "danger" | "neutral"
> = {
  new: "info",
  qualified: "brand",
  nurturing: "warning",
  converted: "success",
  unqualified: "neutral",
  lost: "danger",
};

function statusTone(
  status: string,
): "success" | "warning" | "info" | "brand" | "danger" | "neutral" {
  return STATUS_TONE[status] ?? "neutral";
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Lead source labels — like titleCase but preserves the `dm` acronym as "DM". */
const SOURCE_LABEL: Record<string, string> = {
  comment: "Comment",
  dm: "DM",
  form: "Form",
  discovery: "Discovery",
  manual: "Manual",
};

function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? titleCase(source);
}

function scoreColor(score: number): string {
  if (score >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-muted";
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  const { page: pageParam } = await searchParams;
  // The paginated table and the org-wide KPI summary are independent reads: the
  // summary aggregates across ALL leads so the tiles stay accurate on any page.
  const [{ items: leads, total, page, limit }, summary] = await Promise.all([
    getLeads(parsePageParam(pageParam)),
    getLeadSummary(),
  ]);
  redirectIfPageOutOfRange("/leads", page, limit, total, leads.length);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Leads
        </h1>
        <p className="mt-1 text-sm text-muted">
          Your pipeline — qualified leads, deals, and appointments moving through
          each stage.
        </p>
      </div>

      <section className="stagger grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Total leads" value={summary.total.toLocaleString()} />
        <StatTile label="Qualified" value={summary.qualified.toLocaleString()} />
        <StatTile
          label="Open pipeline"
          value={formatCurrency(summary.openPipeline)}
        />
      </section>

      {total === 0 ? (
        <EmptyState
          icon={<IconLeads className="h-6 w-6" />}
          title="No leads yet"
          description="As BrandPilot qualifies people from comments, DMs, and forms, they will appear here with a score and pipeline stage."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Pipeline</CardTitle>
            {summary.won > 0 ? (
              <Badge tone="success">{formatCurrency(summary.won)} won</Badge>
            ) : null}
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <caption className="sr-only">
                  Leads pipeline: each row is a lead with its source, score,
                  status, stage, and deal value.
                </caption>
                <thead>
                  <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-subtle">
                    <th scope="col" className="px-5 py-2.5 font-medium">Lead</th>
                    <th scope="col" className="px-5 py-2.5 font-medium">Source</th>
                    <th scope="col" className="px-5 py-2.5 font-medium">Score</th>
                    <th scope="col" className="px-5 py-2.5 font-medium">Status</th>
                    <th scope="col" className="px-5 py-2.5 font-medium">Stage</th>
                    <th scope="col" className="px-5 py-2.5 text-right font-medium">Deal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {leads.map((lead: Lead) => (
                    <tr
                      key={lead.id}
                      className="interactive-row hover:bg-surface-muted/60"
                    >
                      <td className="px-5 py-3">
                        <p className="font-medium text-foreground">
                          {lead.name ?? "Unknown"}
                        </p>
                        {lead.email ? (
                          <p className="text-xs text-subtle">{lead.email}</p>
                        ) : null}
                      </td>
                      <td className="px-5 py-3 text-muted">
                        {lead.source ? sourceLabel(lead.source) : "—"}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={cn(
                            "font-semibold tabular-nums",
                            scoreColor(lead.score),
                          )}
                        >
                          {lead.score}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone={statusTone(lead.status)}>
                          {titleCase(lead.status)}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-muted">
                        {lead.stage ?? "—"}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-foreground">
                        {lead.dealAmount !== null
                          ? formatCurrency(lead.dealAmount)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
      <Pager page={page} limit={limit} total={total} basePath="/leads" />
    </div>
  );
}
