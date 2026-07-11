import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  conversations,
  conversationMessages,
  contacts,
  withOrgScope,
  type Database,
} from '@brandpilot/db';
import {
  ok,
  AppError,
  paginationSchema,
  type ApiResponse,
  type Paginated,
} from '@brandpilot/core';
import { logger } from '@brandpilot/observability';
import { DATABASE } from '../db/db.provider';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CurrentOrg } from '../auth/current-org.decorator';
import { zodSchemaClass } from '../common/zod-validation.pipe';

interface ConversationSummary {
  id: string;
  channel: string;
  status: string;
  intent: string | null;
  lastMessageAt: string | null;
  contactHandle: string | null;
}

interface ConversationMessageView {
  id: string;
  direction: string;
  author: string;
  body: string;
  createdAt: string;
}

const THREAD_LIMIT = 50;

/** `?page&limit` query for the paginated conversations list (page 1, limit 20, max 100). */
class ListConversationsQuery extends zodSchemaClass(paginationSchema) {}

/** Body for a human reply: non-empty, capped well above any real message. */
export const replySchema = z.object({ body: z.string().min(1).max(4000) });
export class ReplyBody extends zodSchemaClass(replySchema) {}

/**
 * Best-effort extraction of a display handle from a contact. `contacts.handles`
 * is a free-form jsonb map (e.g. `{ instagram: "@ava" }`); fall back to name or
 * email so the inbox always has something to render.
 */
function pickHandle(
  handles: unknown,
  name: string | null,
  email: string | null,
): string | null {
  if (handles && typeof handles === 'object') {
    const values = Object.values(handles as Record<string, unknown>).filter(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );
    if (values[0]) return values[0];
  }
  return name ?? email ?? null;
}

/**
 * Conversation read-model endpoints scoped to the caller's current org. Mirrors
 * the OrgsController pipeline: JWT auth → RBAC → org-scoped Drizzle read →
 * envelope. Every table is treated as optionally empty — an org with no
 * conversations yields an empty array rather than an error.
 */
@ApiTags('conversations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  @RequirePermissions('conversation:read')
  @ApiOperation({ summary: 'List recent conversations for the current org' })
  async list(
    @CurrentOrg() orgId: string,
    @Query() query: ListConversationsQuery,
  ): Promise<ApiResponse<Paginated<ConversationSummary>>> {
    const { page, limit } = query;
    const { rows, total } = await withOrgScope(this.db, orgId, async (tx) => {
      const [{ value: total }] = await tx
        .select({ value: count() })
        .from(conversations)
        .where(eq(conversations.orgId, orgId));

      const rows = await tx
        .select({
          id: conversations.id,
          channel: conversations.channel,
          status: conversations.status,
          intent: conversations.intent,
          lastMessageAt: conversations.lastMessageAt,
          createdAt: conversations.createdAt,
          contactName: contacts.name,
          contactEmail: contacts.email,
          contactHandles: contacts.handles,
        })
        .from(conversations)
        .leftJoin(contacts, eq(contacts.id, conversations.contactId))
        .where(eq(conversations.orgId, orgId))
        .orderBy(desc(conversations.lastMessageAt))
        .limit(limit)
        .offset((page - 1) * limit);

      return { rows, total };
    });

    const summaries: ConversationSummary[] = rows.map((row) => {
      const last = row.lastMessageAt ?? row.createdAt;
      return {
        id: row.id,
        channel: row.channel,
        status: row.status,
        intent: row.intent,
        lastMessageAt: last ? last.toISOString() : null,
        contactHandle: pickHandle(
          row.contactHandles,
          row.contactName,
          row.contactEmail,
        ),
      };
    });
    return ok<Paginated<ConversationSummary>>({ items: summaries, total, page, limit });
  }

  @Get(':id/messages')
  @RequirePermissions('conversation:read')
  @ApiOperation({ summary: 'List messages for a conversation thread' })
  async messages(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
  ): Promise<ApiResponse<ConversationMessageView[]>> {
    // Org-scoped by conversation ownership under RLS: the WHERE pins both the org
    // and the thread, so a caller can never read another tenant's messages.
    const rows = await withOrgScope(this.db, orgId, (tx) =>
      tx
        .select({
          id: conversationMessages.id,
          direction: conversationMessages.direction,
          authorType: conversationMessages.authorType,
          body: conversationMessages.body,
          createdAt: conversationMessages.createdAt,
        })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.orgId, orgId),
            eq(conversationMessages.conversationId, id),
          ),
        )
        .orderBy(desc(conversationMessages.createdAt))
        .limit(THREAD_LIMIT),
    );

    // The query keeps the most recent THREAD_LIMIT messages (desc); present them
    // oldest→newest for the thread view. Ordering ascending + limit would have
    // returned the OLDEST messages and hidden the current conversation on any
    // thread longer than THREAD_LIMIT.
    const messages: ConversationMessageView[] = [...rows]
      .reverse()
      .map((row) => ({
        id: row.id,
        direction: row.direction,
        author: row.authorType,
        body: row.body ?? '',
        createdAt: (row.createdAt ?? new Date()).toISOString(),
      }));
    return ok(messages);
  }

  /**
   * Record a human reply on a conversation thread — the write side of the
   * inbox: today a conversation can be marked `needs_human` with no way for
   * the owner to actually respond. This does NOT attempt live platform
   * delivery: there is no connector send method wired yet, and delivery needs
   * live provider creds (the same external gate publishing sits behind).
   * Outbound delivery reuses the `SendReply` adapter seam ConversationEngine
   * already defines (packages/modules/conversation/src/conversation-engine.ts)
   * once a real provider is wired; until then this endpoint only records +
   * surfaces the human's reply so it is never silently lost.
   */
  @Post(':id/messages')
  @RequirePermissions('conversation:reply')
  @ApiOperation({ summary: 'Send a human reply on a conversation thread' })
  async reply(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
    @Body() body: ReplyBody,
  ): Promise<ApiResponse<ConversationMessageView>> {
    const created = await withOrgScope(this.db, orgId, async (tx) => {
      // Org + conversation both pinned in the predicate — the same idiom as
      // `messages()` above — but a WRITE must 404 on a miss instead of
      // silently no-op-ing, so a cross-tenant id can never insert into
      // another org's thread.
      const [existing] = await tx
        .select({ id: conversations.id, status: conversations.status })
        .from(conversations)
        .where(and(eq(conversations.id, id), eq(conversations.orgId, orgId)))
        .limit(1);
      if (!existing) {
        throw new AppError('not_found', 'Conversation not found');
      }

      const [message] = await tx
        .insert(conversationMessages)
        .values({
          orgId,
          conversationId: id,
          direction: 'outbound',
          authorType: 'human',
          body: body.body,
        })
        .returning({
          id: conversationMessages.id,
          direction: conversationMessages.direction,
          authorType: conversationMessages.authorType,
          body: conversationMessages.body,
          createdAt: conversationMessages.createdAt,
        });
      if (!message) {
        throw new AppError('internal_error', 'Failed to record the reply');
      }

      // Every new message bumps the thread's position in the inbox list
      // (sorted by lastMessageAt DESC — see the `list()` query above),
      // regardless of whether the status transitions below.
      await tx
        .update(conversations)
        .set({ lastMessageAt: new Date() })
        .where(and(eq(conversations.id, id), eq(conversations.orgId, orgId)));

      // A human reply resolves the escalation. The `existing.status` check is
      // just a cheap short-circuit (skip the statement entirely for an
      // already-closed/ai_handling thread, the common case); the REAL
      // guarantee against clobbering a concurrent status change is the
      // `inArray` in the WHERE below — `withOrgScope`'s transaction is plain
      // READ COMMITTED with no row lock, so another transaction (e.g. the
      // conversation engine processing a new inbound message) could commit a
      // status change between our SELECT above and this UPDATE. Gating the
      // UPDATE itself on the status being STILL open/needs_human makes the
      // transition atomic — a thread the AI has since started handling, or
      // one already closed, is never clobbered — mirroring the claim-via-WHERE
      // idiom in `approvals.controller.ts`'s `decide()`.
      if (existing.status === 'open' || existing.status === 'needs_human') {
        await tx
          .update(conversations)
          .set({ status: 'closed' })
          .where(
            and(
              eq(conversations.id, id),
              eq(conversations.orgId, orgId),
              inArray(conversations.status, ['open', 'needs_human']),
            ),
          );
      }

      return message;
    });

    logger.info({ orgId, conversationId: id }, 'human reply recorded');

    return ok<ConversationMessageView>({
      id: created.id,
      direction: created.direction,
      author: created.authorType,
      body: created.body ?? '',
      createdAt: (created.createdAt ?? new Date()).toISOString(),
    });
  }
}
