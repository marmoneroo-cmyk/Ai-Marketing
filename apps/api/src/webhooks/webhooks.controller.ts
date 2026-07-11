import {
  Controller,
  Get,
  Inject,
  Post,
  Query,
  RawBodyRequest,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { Queue } from 'bullmq';
import { and, eq, inArray } from 'drizzle-orm';
import { socialAccounts, type Database } from '@brandpilot/db';
import {
  AppError,
  type ConversationInboundJobData,
  type SocialProvider,
} from '@brandpilot/core';
import { loadEnv } from '@brandpilot/config';
import { DATABASE } from '../db/db.provider';
import { CONVERSATION_INBOUND_QUEUE } from '../queue/queue.provider';
import { Public } from '../auth/public.decorator';
import { verifyMetaSignature } from '../common/webhook-signature';
import { parseMetaWebhook, type ParsedInbound } from './meta-payload';

/** Providers we accept inbound events from, keyed by URL segment. */
type WebhookKind = 'meta' | 'whatsapp';

/** Query params on the GET verification handshake (Meta uses `hub.*`). */
interface HubVerifyQuery {
  'hub.mode'?: string;
  'hub.verify_token'?: string;
  'hub.challenge'?: string;
}

/** social_accounts providers each webhook may resolve an org from. */
const PROVIDERS_BY_KIND: Record<WebhookKind, SocialProvider[]> = {
  meta: ['instagram', 'facebook'],
  whatsapp: ['whatsapp'],
};

/** Constant-time string equality (length-guarded) for the verify-token compare. */
function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Inbound provider webhooks. These are public, machine-to-machine endpoints:
 *
 * - `GET`  performs Meta's subscribe handshake, echoing `hub.challenge` when the
 *   verify token matches the configured value.
 * - `POST` verifies the `X-Hub-Signature-256` HMAC over the *raw* body before
 *   parsing it and enqueueing each message to the conversation-inbound queue.
 *
 * They deliberately omit the JWT + permissions guards (authenticated by the
 * signature instead) and skip rate limiting so provider retries are not dropped.
 */
@Public()
@SkipThrottle()
@ApiExcludeController()
@Controller('connectors')
export class WebhooksController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CONVERSATION_INBOUND_QUEUE)
    private readonly inboundQueue: Queue<ConversationInboundJobData>,
  ) {}

  @Get('meta/webhook')
  metaVerify(@Query() query: HubVerifyQuery, @Res() res: Response): void {
    this.handleVerification(query, loadEnv().META_VERIFY_TOKEN, res);
  }

  @Post('meta/webhook')
  async metaReceive(
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ): Promise<void> {
    await this.handleReceive(req, res, 'meta');
  }

  @Get('whatsapp/webhook')
  whatsappVerify(@Query() query: HubVerifyQuery, @Res() res: Response): void {
    this.handleVerification(query, loadEnv().WHATSAPP_VERIFY_TOKEN, res);
  }

  @Post('whatsapp/webhook')
  async whatsappReceive(
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ): Promise<void> {
    await this.handleReceive(req, res, 'whatsapp');
  }

  /**
   * Meta subscribe handshake: when `hub.mode === 'subscribe'` and the verify
   * token matches, echo the raw challenge as text/plain; otherwise 403.
   */
  private handleVerification(
    query: HubVerifyQuery,
    expectedToken: string | undefined,
    res: Response,
  ): void {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (
      mode === 'subscribe' &&
      expectedToken &&
      token !== undefined &&
      timingSafeEqualStr(token, expectedToken) &&
      challenge !== undefined
    ) {
      res.status(200).type('text/plain').send(challenge);
      return;
    }
    res.status(403).type('text/plain').send('Forbidden');
  }

  /**
   * Verify the request signature over the raw body, then parse + enqueue. Always
   * ACKs 200 after a valid signature so Meta does not retry a payload we have
   * accepted (unparseable/foreign events are simply skipped).
   */
  private async handleReceive(
    req: RawBodyRequest<Request>,
    res: Response,
    kind: WebhookKind,
  ): Promise<void> {
    const env = loadEnv();
    if (!env.META_APP_SECRET) {
      throw new AppError('bad_request', 'META_APP_SECRET is not configured');
    }

    const signature = req.header('x-hub-signature-256') ?? undefined;
    if (!verifyMetaSignature(req.rawBody, signature, env.META_APP_SECRET)) {
      throw new AppError('unauthorized', 'Invalid webhook signature');
    }

    const parsed = parseMetaWebhook(req.body, kind);
    await this.enqueue(parsed, kind);

    res.status(200).json({ received: true });
  }

  /**
   * Resolve each record's provider account id to an org (via social_accounts)
   * and enqueue an inbound job. Records whose account is unknown are skipped.
   * The account→org lookup is intentionally unscoped: the request is trusted by
   * its verified signature and the org is not yet known at this point.
   */
  private async enqueue(parsed: ParsedInbound[], kind: WebhookKind): Promise<void> {
    if (parsed.length === 0) return;

    const accountIds = [...new Set(parsed.map((p) => p.accountId))];
    const accounts = await this.db
      .select({ orgId: socialAccounts.orgId, externalId: socialAccounts.externalId })
      .from(socialAccounts)
      .where(
        and(
          inArray(socialAccounts.externalId, accountIds),
          inArray(socialAccounts.provider, PROVIDERS_BY_KIND[kind]),
        ),
      );

    const orgByAccount = new Map(accounts.map((a) => [a.externalId, a.orgId]));

    for (const item of parsed) {
      const orgId = orgByAccount.get(item.accountId);
      if (!orgId) continue; // unknown account → not one of ours; skip
      const job: ConversationInboundJobData = {
        orgId,
        channel: item.channel,
        externalThreadId: item.externalThreadId,
        text: item.text,
        ...(item.messageExternalId ? { messageExternalId: item.messageExternalId } : {}),
        ...(item.contact ? { contact: item.contact } : {}),
      };
      await this.inboundQueue.add('inbound', job, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      });
    }
  }
}
