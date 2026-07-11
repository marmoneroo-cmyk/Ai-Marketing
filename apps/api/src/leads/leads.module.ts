import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LeadsController } from './leads.controller';

/**
 * Leads feature module. Imports AuthModule for the JWT + permissions guards; the
 * Drizzle client is injected from the global DbModule.
 */
@Module({
  imports: [AuthModule],
  controllers: [LeadsController],
})
export class LeadsModule {}
