import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { OrgsController } from './orgs.controller';
import { OrgInviteService } from './org-invite.service';

/**
 * Orgs feature module. Imports AuthModule for the JWT + permissions guards and
 * EmailModule for the shared `EMAIL_SENDER` (used by OrgInviteService to email
 * invite links); the Drizzle client is injected from the global DbModule.
 */
@Module({
  imports: [AuthModule, EmailModule],
  controllers: [OrgsController],
  providers: [OrgInviteService],
})
export class OrgsModule {}
