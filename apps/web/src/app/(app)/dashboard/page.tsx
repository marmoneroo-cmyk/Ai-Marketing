import type { Metadata } from "next";
import Link from "next/link";
import { StatTile } from "@/components/ui/stat-tile";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ScoreRing } from "@/components/ScoreRing";
import { ApprovalsPanel } from "@/components/ApprovalsPanel";
import { VerifyEmailBanner } from "@/components/verify-email-banner";
import {
  IconAppointments,
  IconCheck,
  IconLeads,
  IconReach,
  IconRevenue,
  IconRocket,
  IconSpark,
} from "@/components/icons";
import { getDashboard, getOrgProfile } from "@/lib/api";
import { formatCompactNumber, formatCurrency, formatTime } from "@/lib/format";
import type { Recommendation } from "@/lib/types";

export const metadata: Metadata = { title: "Dashboard" };

const IMPACT_TONE: Record<Recommendation["impact"], "danger" | "warning" | "neutral"> =
  {
    high: "danger",
    medium: "warning",
    low: "neutral",
  };

function firstName(fullName: string): string {
  return fullName.split(" ")[0] ?? fullName;
}

export default async function DashboardPage() {
  const [snapshot, org] = await Promise.all([getDashboard(), getOrgProfile()]);
  const { kpis, scores, approvals, recommendations, completedTasks } = snapshot;

  const hasActivity =
    approvals.length > 0 ||
    recommendations.length > 0 ||
    completedTasks.length > 0;

  // Only surface the KPI tiles once there's a real number to show — otherwise a
  // brand-new org sees a row of five "0" tiles stacked above the "get started"
  // empty state, which reads as broken. Followers alone (from a fresh connect)
  // is enough to make the tiles worth showing.
  const hasKpis =
    kpis.reach > 0 ||
    kpis.leads > 0 ||
    kpis.appointments > 0 ||
    kpis.revenue > 0 ||
    kpis.followers > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {!org.emailVerified ? <VerifyEmailBanner /> : null}

      {/* Heading */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Good morning, {firstName(org.ownerName)}
          </h1>
          <p className="mt-1 text-sm text-muted">
            Here&apos;s what BrandPilot did while you were away — and the few
            calls it needs from you.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" asChild>
            <Link href="/onboarding">
              <IconRocket className="h-4 w-4" />
              Set up channels
            </Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/content">New post</Link>
          </Button>
        </div>
      </div>

      {/* KPI tiles — hidden until there's a real number, so a fresh org isn't
          greeted by a wall of zeros above the empty state. */}
      {hasActivity || hasKpis ? (
      <section className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Reach"
          value={formatCompactNumber(kpis.reach)}
          delta={kpis.reachDelta}
          icon={<IconReach className="h-4 w-4" />}
          href="/analytics"
        />
        <StatTile
          label="Leads"
          value={kpis.leads.toLocaleString()}
          delta={kpis.leadsDelta}
          icon={<IconLeads className="h-4 w-4" />}
          href="/leads"
        />
        <StatTile
          label="Appointments"
          value={kpis.appointments.toLocaleString()}
          delta={kpis.appointmentsDelta}
          icon={<IconAppointments className="h-4 w-4" />}
          href="/calendar"
        />
        <StatTile
          label="Revenue"
          value={formatCurrency(kpis.revenue)}
          delta={kpis.revenueDelta}
          icon={<IconRevenue className="h-4 w-4" />}
          href="/analytics"
        />
        <StatTile
          label="Followers"
          value={formatCompactNumber(kpis.followers)}
          delta={kpis.followersDelta}
          icon={<IconLeads className="h-4 w-4" />}
          href="/analytics"
        />
      </section>
      ) : null}

      {!hasActivity ? (
        <EmptyState
          icon={<IconRocket className="h-6 w-6" />}
          title="Your command center is ready"
          description="Connect your channels and point BrandPilot at your website. As it starts working, approvals, recommendations, and completed tasks will appear here."
          action={
            <Button asChild>
              <Link href="/onboarding">Set up your channels</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left column: scores + approvals */}
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Business health</CardTitle>
                <span className="text-xs font-medium text-subtle">
                  vs. last 30 days
                </span>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4 py-2">
                  <ScoreRing label="Marketing" value={scores.marketing} accent="brand" />
                  <ScoreRing label="Sales" value={scores.sales} accent="emerald" />
                  <ScoreRing label="Growth" value={scores.growth} accent="sky" />
                </div>
              </CardContent>
            </Card>

            <div className="space-y-2">
              {approvals.length > 0 ? (
                <div className="flex justify-end">
                  <Link
                    href="/approvals"
                    className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-fg"
                  >
                    View all →
                  </Link>
                </div>
              ) : null}
              <ApprovalsPanel approvals={approvals} />
            </div>
          </div>

          {/* Right column: recommendations + tasks */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>
                  <span className="inline-flex items-center gap-1.5">
                    <IconSpark className="h-4 w-4 text-brand-500" />
                    AI recommendations
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {recommendations.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted">
                    No recommendations yet.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {recommendations.map((rec) => (
                      <li
                        key={rec.id}
                        className="rounded-xl border border-border bg-surface-muted/60 p-3.5"
                      >
                        <div className="flex items-center gap-2">
                          <Badge tone={IMPACT_TONE[rec.impact]}>{rec.impact} impact</Badge>
                          <span className="ml-auto text-xs font-medium text-subtle">
                            {rec.confidence}%
                          </span>
                        </div>
                        <p className="mt-2 text-sm font-medium text-foreground">
                          {rec.title}
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-muted">
                          {rec.detail}
                        </p>
                        <p className="mt-2 text-2xs font-medium uppercase tracking-wide text-subtle">
                          {rec.module}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Tasks completed today</CardTitle>
                <Badge tone="success">{completedTasks.length}</Badge>
              </CardHeader>
              <CardContent>
                {completedTasks.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted">
                    No tasks completed yet today.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {completedTasks.map((task) => (
                      <li key={task.id} className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
                          <IconCheck className="h-3 w-3" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm text-foreground">{task.label}</p>
                          <p className="text-xs text-subtle">
                            {task.module} · {formatTime(task.at)}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
