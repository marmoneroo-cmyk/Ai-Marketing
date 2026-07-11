import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DashboardController } from './dashboard.controller';

/**
 * Dashboard feature module. Imports AuthModule for the JWT + permissions guards;
 * the Drizzle client is injected from the global DbModule.
 */
@Module({
  imports: [AuthModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
