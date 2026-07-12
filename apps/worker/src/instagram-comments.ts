import { and, eq } from 'drizzle-orm';
import { createConnector, decryptToken } from '@brandpilot/connectors';
import { socialAccounts, connectorTokens } from '@brandpilot/db';
import { logger } from '@brandpilot/observability';
import type { WorkerContext } from './context';

/** How many recent posts to scan for comments per poll (bounds API + LLM work). */
const MEDIA_LIMIT = 12;
/** How many comments to read per post per poll. */
const COMMENT_LIMIT = 50;

/** Normalize a handle for owner-comparison: strip a leading @ and lowercase. */
function normalizeHandle(handle: string): string {
  return handle.replace(/^@/, '').trim().toLowerCase();
}

/** Shape of the raw comment payload the Instagram connector returns. */
interface RawComment {
  text?: string;
  username?: string;
}

/**
 * Poll an org's connected Instagram account for comments on its recent media and
 * ingest each NEW customer comment into the inbox via the Conversation Engine
 * (which persists it, dedups on the comment id, classifies intent, and drafts a
 * grounded reply or escalates). Comments authored by the business itself are
 * skipped — those are our own replies, not customer messages.
 *
 * Fully best-effort and bounded: one bad media/comment is logged and skipped,
 * never aborting the rest. Requires the `instagram_business_manage_comments`
 * scope on the connected account (granted by re-connecting). Returns how many
 * new comments were ingested.
 */
export async function pullInstagramComments(ctx: WorkerContext, orgId: string): Promise<number> {
  const [account] = await ctx.db
    .select({
      id: socialAccounts.id,
      externalId: socialAccounts.externalId,
      handle: socialAccounts.handle,
    })
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.orgId, orgId),
        eq(socialAccounts.provider, 'instagram'),
        eq(socialAccounts.status, 'connected'),
      ),
    )
    .limit(1);
  if (!account) return 0;

  const [tok] = await ctx.db
    .select()
    .from(connectorTokens)
    .where(eq(connectorTokens.socialAccountId, account.id))
    .limit(1);
  if (!tok) {
    logger.warn({ orgId, accountId: account.id }, 'no token for instagram account; cannot poll comments');
    return 0;
  }

  const accessToken = decryptToken(tok.accessTokenEnc);
  const connector = createConnector('instagram');
  const ownerHandle = account.handle ? normalizeHandle(account.handle) : '';

  let media: Awaited<ReturnType<typeof connector.pull>>;
  try {
    media = await connector.pull('media', { accountId: account.externalId, accessToken, limit: MEDIA_LIMIT });
  } catch (err: unknown) {
    logger.warn({ err, orgId }, 'instagram media pull failed; skipping comment poll');
    return 0;
  }

  let ingested = 0;
  for (const post of media) {
    let comments: Awaited<ReturnType<typeof connector.pull>>;
    try {
      comments = await connector.pull('comments', {
        accountId: post.externalId,
        accessToken,
        limit: COMMENT_LIMIT,
      });
    } catch (err: unknown) {
      // A single post's comments failing (e.g. permissions on one item) must not
      // abort the whole poll.
      logger.warn({ err, orgId, mediaId: post.externalId }, 'instagram comments pull failed for media');
      continue;
    }

    for (const comment of comments) {
      const raw = (comment.raw ?? {}) as RawComment;
      const text = raw.text?.trim();
      if (!text) continue; // sticker/empty comment — nothing to reply to
      // Skip our own comments (business replies), keep only customer messages.
      if (ownerHandle && raw.username && normalizeHandle(raw.username) === ownerHandle) continue;

      try {
        const res = await ctx.conversation.handleInbound(orgId, {
          channel: 'ig_comment',
          externalThreadId: comment.externalId, // one conversation per comment thread
          messageExternalId: comment.externalId, // dedups re-polls (partial-unique on org+externalId)
          text,
          ...(raw.username ? { contact: { handle: raw.username } } : {}),
        });
        if (res.status !== 'duplicate_ignored') ingested += 1; // don't count re-polls
      } catch (err: unknown) {
        logger.warn({ err, orgId, commentId: comment.externalId }, 'failed to ingest instagram comment');
      }
    }
  }

  if (ingested > 0) {
    logger.info({ orgId, ingested }, 'ingested instagram comments into inbox');
  }
  return ingested;
}
