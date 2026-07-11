"use client";

import { useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { AutonomySwitch } from "@/components/AutonomySwitch";
import { SocialConnectButton } from "@/components/SocialConnectButton";
import { PlatformBadge } from "@/components/platform-badge";
import { TeamManagementCard } from "@/components/TeamManagementCard";
import { formatCurrency, formatDayLabel } from "@/lib/format";
import { PLATFORM_LABEL } from "@/lib/platform";
import { SUPPORT_EMAIL } from "@/lib/constants";
import type {
  ChannelStatus,
  ConnectedChannel,
  OrgInvite,
  OrgMember,
  OrgProfile,
  Platform,
} from "@/lib/types";

/** One-shot OAuth connect outcome, read from the callback's redirect query. */
export interface ConnectResult {
  status: "success" | "error";
  provider: string;
}

interface SettingsClientProps {
  channels: ConnectedChannel[];
  org: OrgProfile;
  members: OrgMember[];
  invites: OrgInvite[];
  connectResult?: ConnectResult | null;
}

const STATUS_TONE: Record<ChannelStatus, "success" | "danger" | "neutral"> = {
  connected: "success",
  error: "danger",
  disconnected: "neutral",
};

const PLAN_LABEL: Record<OrgProfile["plan"], string> = {
  free: "Free plan",
  starter: "Starter plan",
  pro: "Pro plan",
};

const STATUS_LABEL: Record<ChannelStatus, string> = {
  connected: "Connected",
  error: "Needs attention",
  disconnected: "Not connected",
};

function ChannelRow({ channel }: { channel: ConnectedChannel }) {
  const label = PLATFORM_LABEL[channel.provider];
  return (
    <li className="interactive-row flex flex-wrap items-center gap-3 px-5 py-4 hover:bg-surface-muted/60">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <PlatformBadge platform={channel.provider} />
          <Badge tone={STATUS_TONE[channel.status]}>
            {STATUS_LABEL[channel.status]}
          </Badge>
        </div>
        <p className="mt-1.5 truncate text-sm text-muted">
          {channel.handle
            ? channel.handle
            : "Connect this channel so BrandPilot can publish and reply."}
          {channel.connectedAt ? (
            <span className="text-subtle">
              {" "}
              · since {formatDayLabel(channel.connectedAt)}
            </span>
          ) : null}
        </p>
      </div>
      {channel.status === "connected" ? (
        <span className="text-xs font-medium text-subtle">Managed</span>
      ) : (
        <SocialConnectButton
          provider={channel.provider}
          label={
            channel.status === "error" ? `Reconnect ${label}` : `Connect ${label}`
          }
        />
      )}
    </li>
  );
}

export function SettingsClient({
  channels,
  org,
  members,
  invites,
  connectResult,
}: SettingsClientProps) {
  const { notify } = useToast();

  useEffect(() => {
    if (!connectResult) return;
    const label =
      PLATFORM_LABEL[connectResult.provider as Platform] ?? connectResult.provider;
    if (connectResult.status === "success") {
      notify(`${label} connected successfully.`, "success");
    } else {
      notify(`Couldn't connect ${label}. Please try again.`, "error");
    }
    // Strip the one-shot param so a refresh doesn't re-announce the outcome.
    window.history.replaceState(null, "", "/settings");
  }, [connectResult, notify]);

  return (
    <div className="space-y-6">
      {/* Connected channels */}
      <Card>
        <CardHeader>
          <CardTitle>Connected channels</CardTitle>
          <Badge tone="neutral">
            {channels.filter((c) => c.status === "connected").length}/
            {channels.length} connected
          </Badge>
        </CardHeader>
        {channels.length === 0 ? (
          <CardContent>
            <p className="py-4 text-center text-sm text-muted">
              No channels available yet.
            </p>
          </CardContent>
        ) : (
          <ul className="stagger divide-y divide-border">
            {channels.map((channel) => (
              <ChannelRow key={channel.provider} channel={channel} />
            ))}
          </ul>
        )}
      </Card>

      {/* Autonomy + caps */}
      <Card>
        <CardHeader>
          <CardTitle>Autonomy &amp; caps</CardTitle>
          <Badge tone="brand">{PLAN_LABEL[org.plan]}</Badge>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">
                Autonomy mode
              </p>
              <p className="mt-0.5 text-sm text-muted">
                How much BrandPilot can do before asking you.
              </p>
            </div>
            <AutonomySwitch initial={org.autonomy} />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <CapTile label="Daily posts" value={String(org.caps.dailyPosts)} />
            <CapTile
              label="Monthly budget"
              value={formatCurrency(org.caps.monthlyBudget)}
            />
            <CapTile
              label="Max quote value"
              value={formatCurrency(org.caps.maxQuoteValue)}
            />
          </div>
          <p className="text-xs text-subtle">
            Caps bound what &ldquo;Auto&rdquo; mode may spend or send without
            your approval. They come with your plan &mdash;{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="font-medium text-brand-600 hover:text-brand-700 dark:text-brand-fg"
            >
              contact your account team
            </a>{" "}
            to adjust them.
          </p>
        </CardContent>
      </Card>

      {/* Org / profile */}
      <Card>
        <CardHeader>
          <CardTitle>Organization</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Business name" defaultValue={org.orgName} readOnly />
          <Input label="Owner" defaultValue={org.ownerName} readOnly />
          <Input
            label="Email"
            type="email"
            defaultValue={org.ownerEmail}
            readOnly
            className="sm:col-span-2"
          />
          <p className="text-xs text-subtle sm:col-span-2">
            Profile editing is managed by your account team.{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="font-medium text-brand-600 hover:text-brand-700 dark:text-brand-fg"
            >
              Contact support
            </a>{" "}
            to change these details.
          </p>
        </CardContent>
      </Card>

      {/* Team members + invites */}
      <TeamManagementCard members={members} invites={invites} />
    </div>
  );
}

function CapTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-muted/60 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-subtle">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tracking-tight text-foreground">
        {value}
      </p>
    </div>
  );
}
