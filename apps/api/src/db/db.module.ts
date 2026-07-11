import { Global, Module } from '@nestjs/common';
import { databaseProvider, DATABASE } from './db.provider';

/**
 * Global module exposing the Drizzle client under the DATABASE token so every
 * feature module can inject the same connection pool.
 */
@Global()
@Module({
  providers: [databaseProvider],
  exports: [DATABASE],
})
export class DbModule {}
