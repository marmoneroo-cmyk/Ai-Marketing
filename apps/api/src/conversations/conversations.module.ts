import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConversationsController } from './conversations.controller';

/**
 * Conversations feature module. Imports AuthModule for the JWT + permissions
 * guards; the Drizzle client is injected from the global DbModule.
 */
@Module({
  imports: [AuthModule],
  controllers: [ConversationsController],
})
export class ConversationsModule {}
