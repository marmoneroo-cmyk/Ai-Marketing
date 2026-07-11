"use client";

import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { sendReply } from "@/lib/api";
import type { ConversationMessage } from "@/lib/types";

interface ReplyComposerProps {
  conversationId: string;
  /** Called with the created message once the API confirms the reply was recorded. */
  onSent: (message: ConversationMessage) => void;
}

/**
 * Human reply composer for an inbox thread: a labeled textarea + send button.
 * This is the write side of the inbox — previously a conversation could be
 * marked `needs_human` with no way for the owner to actually respond.
 *
 * Delivery is NOT live: see the API's `POST /conversations/:id/messages`
 * comment — there is no connector send method wired yet, so this only records
 * + surfaces the reply in the thread (never fabricates a real platform send).
 *
 * Enter sends; Shift+Enter inserts a newline.
 */
export function ReplyComposer({ conversationId, onSent }: ReplyComposerProps) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const { notify } = useToast();

  async function handleSend() {
    const body = value.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const message = await sendReply(conversationId, body);
      onSent(message);
      setValue("");
    } catch (error: unknown) {
      notify(
        error instanceof Error ? error.message : "Couldn't send your reply. Please try again.",
        "error",
      );
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Skip while an IME composition is in progress (e.g. confirming a CJK
    // candidate with Enter) — that Enter should not submit the form.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void handleSend();
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <label htmlFor={`reply-composer-${conversationId}`} className="text-xs font-medium text-muted">
        Reply as yourself
      </label>
      <textarea
        id={`reply-composer-${conversationId}`}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={sending}
        aria-busy={sending}
        placeholder="Type your reply…"
        rows={3}
        className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-subtle">Shift+Enter for a new line</span>
        <Button
          size="sm"
          onClick={() => void handleSend()}
          disabled={sending || value.trim().length === 0}
        >
          {sending ? "Sending…" : "Send reply"}
        </Button>
      </div>
    </div>
  );
}
