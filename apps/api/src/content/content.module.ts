import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContentController } from './content.controller';

/**
 * Content feature module. Imports AuthModule for the JWT + permissions guards;
 * the Drizzle client is injected from the global DbModule.
 */
@Module({
  imports: [AuthModule],
  controllers: [ContentController],
})
export class ContentModule {}
