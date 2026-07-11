import type { Metadata } from "next";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { IconInbox } from "@/components/icons";
import { Pager } from "@/components/ui/pager";
import { ConversationThread } from "@/components/ConversationThread";
import { getConversationMessages, getConversations } from "@/lib/api";
import {
  parsePageParam,
  redirectIfPageOutOfRange,
  type PageSearchParams,
} from "@/lib/pagination";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { ConversationSummary } from "@/lib/types";

export const metadata: Metadata = { title: "Inbox" };

const STATUS_TONE: Record<string, "success" | "warning" | "info" | "neutral"> = {
  open: "info",
  ai_handling: "success",
  needs_human: "warning",
  closed: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  ai_handling: "AI handling",
  needs_human: "Needs you",
  closed: "Closed",
};

function statusTone(status: string): "success" | "warning" | "info" | "neutral" {
  return STATUS_TONE[status] ?? "neutral";
}

function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

/** Human labels for the raw ConversationChannel enum (e.g. `fb_comment`). */
const CHANNEL_LABEL: Record<string, string> = {
  ig_comment: "Instagram comment",
  ig_dm: "Instagram DM",
  fb_comment: "Facebook comment",
  messenger: "Messenger",
  whatsapp: "WhatsApp",
};

function channelLabel(channel: string): string {
  return CHANNEL_LABEL[channel] ?? channel;
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams & { conversation?: string }>;
}) {
  const { page: pageParam, conversation: selectedId } = await searchParams;
  const { items: conversations, total, page, limit } = await getConversations(
    parsePageParam(pageParam),
  );
  redirectIfPageOutOfRange("/inbox", page, limit, total, conversations.length);
  // Selected conversation (via ?conversation=) must be on the current page; fall
  // back to the first so the thread pane is never empty when conversations exist.
  const active: ConversationSummary | undefined =
    conversations.find((c) => c.id === selectedId) ?? conversations[0];
  const messages = active ? await getConversationMessages(active.id) : [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Inbox
        </h1>
        <p className="mt-1 text-sm text-muted">
          Comments, DMs, and messages BrandPilot is handling — with escalations
          surfaced to you.
        </p>
      </div>

      {total === 0 ? (
        <EmptyState
          icon={<IconInbox className="h-6 w-6" />}
          title="No conversations yet"
          description="When customers comment or message you, BrandPilot will triage them here and reply in your brand voice."
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* Conversation list */}
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Conversations</CardTitle>
                <Badge tone="neutral">{total}</Badge>
              </CardHeader>
              <ul className="stagger divide-y divide-border">
                {conversations.map((conv) => {
                  const isActive = active?.id === conv.id;
                  return (
                    <li key={conv.id}>
                      <Link
                        href={`/inbox?page=${page}&conversation=${conv.id}`}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "interactive-row flex w-full items-start gap-3 px-5 py-3.5 text-left",
                          isActive
                            ? "bg-brand-surface/40"
                            : "hover:bg-surface-muted/60",
                        )}
                      >
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-muted">
                        {(conv.contactHandle ?? "?")
                          .replace(/^@/, "")
                          .charAt(0)
                          .toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium text-foreground">
                            {conv.contactHandle ?? "Unknown contact"}
                          </p>
                          <span className="ml-auto shrink-0 text-xs text-subtle">
                            {conv.lastMessageAt
                              ? formatRelative(conv.lastMessageAt)
                              : ""}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted">
                          {channelLabel(conv.channel)}
                          {conv.intent ? ` · ${conv.intent}` : ""}
                        </p>
                        <div className="mt-1.5">
                          <Badge tone={statusTone(conv.status)}>
                            {statusLabel(conv.status)}
                          </Badge>
                        </div>
                      </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
            <Pager page={page} limit={limit} total={total} basePath="/inbox" />
          </div>

          {/* Thread preview */}
          <div className="lg:col-span-3">
            <Card>
              <CardHeader>
                <CardTitle>{active?.contactHandle ?? "Thread"}</CardTitle>
                {active ? (
                  <Badge tone={statusTone(active.status)}>
                    {statusLabel(active.status)}
                  </Badge>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-3">
                {active ? (
                  <ConversationThread
                    key={active.id}
                    conversationId={active.id}
                    status={active.status}
                    initialMessages={messages}
                  />
                ) : (
                  <p className="py-8 text-center text-sm text-muted">
                    No messages in this thread yet.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
