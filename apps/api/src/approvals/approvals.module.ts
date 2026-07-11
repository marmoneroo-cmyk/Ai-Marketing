import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ApprovalsController } from './approvals.controller';

/**
 * Approvals feature module. Imports AuthModule for the JWT + permissions guards;
 * the Drizzle client is injected from the global DbModule.
 */
@Module({
  imports: [AuthModule],
  controllers: [ApprovalsController],
})
export class ApprovalsModule {}
