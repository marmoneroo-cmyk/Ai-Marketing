import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConnectorsController } from './connectors.controller';

/**
 * Connectors feature module. Imports AuthModule for the JWT + permissions guards;
 * the Drizzle client is injected from the global DbModule.
 */
@Module({
  imports: [AuthModule],
  controllers: [ConnectorsController],
})
export class ConnectorsModule {}
