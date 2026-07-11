"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/format";
import { ReplyComposer } from "@/components/ReplyComposer";
import type { ConversationMessage } from "@/lib/types";

interface ConversationThreadProps {
  conversationId: string;
  /** Current conversation status; gates whether the reply composer is shown. */
  status: string;
  /** Server-fetched messages to seed local state with. */
  initialMessages: ConversationMessage[];
}

/**
 * Statuses a human can still reply into. A closed thread is done; an
 * `ai_handling` thread is being actively worked by the AI — the composer is
 * reserved for the open/needs_human "the AI can't/didn't handle this" case.
 */
const REPLYABLE_STATUSES = new Set(["open", "needs_human"]);

/**
 * Client island for the inbox thread pane. Renders the server-fetched seed
 * messages, then — for a thread a human can still act on — the reply composer
 * beneath them. Appends the composer's returned message to the thread only
 * after the API confirms it was recorded (optimistic-after-success, never
 * before), so a failed send never shows a reply that wasn't actually saved.
 *
 * Rendered with `key={conversationId}` by the parent page so switching the
 * active conversation remounts this component and resets its local state
 * instead of carrying over the previous thread's messages.
 */
export function ConversationThread({
  conversationId,
  status,
  initialMessages,
}: ConversationThreadProps) {
  const [messages, setMessages] = useState(initialMessages);

  function handleSent(message: ConversationMessage) {
    setMessages((prev) => [...prev, message]);
  }

  return (
    <>
      {messages.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">
          No messages in this thread yet.
        </p>
      ) : (
        messages.map((msg) => {
          const outbound = msg.direction === "outbound";
          return (
            <div
              key={msg.id}
              className={cn(
                "flex flex-col",
                outbound ? "items-end" : "items-start",
              )}
            >
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                  outbound
                    ? "bg-brand-600 text-white"
                    : "bg-surface-muted text-foreground",
                )}
              >
                {msg.body}
              </div>
              <span className="mt-1 px-1 text-xs text-subtle">
                {msg.author} · {formatTime(msg.createdAt)}
              </span>
            </div>
          );
        })
      )}

      {REPLYABLE_STATUSES.has(status) ? (
        <ReplyComposer conversationId={conversationId} onSent={handleSent} />
      ) : null}
    </>
  );
}
