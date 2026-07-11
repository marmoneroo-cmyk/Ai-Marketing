import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';

/**
 * Inbound provider webhooks. No AuthModule import: these routes are public and
 * authenticated by their HMAC signature, not the JWT guards. The Drizzle client
 * and the conversation-inbound queue are injected from the global modules.
 */
@Module({
  controllers: [WebhooksController],
})
export class WebhooksModule {}
