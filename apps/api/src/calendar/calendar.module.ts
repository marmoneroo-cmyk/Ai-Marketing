import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CalendarController } from './calendar.controller';

/**
 * Calendar feature module. Imports AuthModule for the JWT + permissions guards;
 * the Drizzle client is injected from the global DbModule.
 */
@Module({
  imports: [AuthModule],
  controllers: [CalendarController],
})
export class CalendarModule {}
