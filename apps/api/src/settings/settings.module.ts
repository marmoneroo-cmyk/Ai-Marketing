import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SettingsController } from './settings.controller';

/**
 * Settings feature module. Imports AuthModule for the JWT + permissions guards;
 * the Drizzle client is injected from the global DbModule.
 */
@Module({
  imports: [AuthModule],
  controllers: [SettingsController],
})
export class SettingsModule {}
