import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { loadEnv } from '@brandpilot/config';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { AuthController } from './auth.controller';
import { GoogleOAuthController } from './google-oauth.controller';
import { PasswordResetService } from './password-reset.service';
import { EmailVerificationService } from './email-verification.service';
import { InviteAcceptanceService } from './invite-acceptance.service';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionsGuard } from './permissions.guard';
import { EmailModule } from '../email/email.module';

// Access-token lifetime. Kept deliberately short: it's a stateless JWT that
// cannot be revoked, so it defines the window in which a signed-out or
// compromised session's access token still works. Long-lived sessions come from
// the refresh token (see SessionService + REFRESH_TOKEN_TTL_MS), which IS
// server-side-revocable; the client silently rotates the access token in the
// background, so users stay signed in without ever seeing this expire.
const ACCESS_TOKEN_TTL = '15m';

/**
 * Auth module. Registers passport + JWT (signed with AUTH_SECRET) and exposes
 * the guards so feature modules can protect their routes. Imports EmailModule
 * (rather than binding its own `EMAIL_SENDER` provider) so PasswordResetService
 * and EmailVerificationService resolve the SAME shared sender as any other
 * module that also imports EmailModule (e.g. OrgsModule) — no duplication.
 */
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: loadEnv().AUTH_SECRET,
      signOptions: { expiresIn: ACCESS_TOKEN_TTL },
    }),
    EmailModule,
  ],
  controllers: [AuthController, GoogleOAuthController],
  providers: [
    AuthService,
    SessionService,
    PasswordResetService,
    EmailVerificationService,
    InviteAcceptanceService,
    JwtStrategy,
    JwtAuthGuard,
    PermissionsGuard,
  ],
  exports: [JwtAuthGuard, PermissionsGuard],
})
export class AuthModule {}
