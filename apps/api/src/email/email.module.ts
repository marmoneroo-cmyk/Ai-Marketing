import { Module } from '@nestjs/common';
import { EMAIL_SENDER } from './email-sender';
import { LoggingEmailSender } from './logging-email-sender';

/**
 * Shared email module. Provides `EMAIL_SENDER` (currently `LoggingEmailSender`
 * — see that class for the swap-in-a-real-provider path) and exports the
 * token so any feature module (Auth, Orgs, ...) can inject it without each
 * registering its own provider. Import this module rather than binding
 * `EMAIL_SENDER` locally — a duplicate binding would silently shadow this one
 * within that module's scope.
 */
@Module({
  providers: [{ provide: EMAIL_SENDER, useClass: LoggingEmailSender }],
  exports: [EMAIL_SENDER],
})
export class EmailModule {}
