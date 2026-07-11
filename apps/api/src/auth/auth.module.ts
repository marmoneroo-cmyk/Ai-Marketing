import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { loadEnv } from '@brandpilot/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { GoogleOAuthController } from './google-oauth.controller';
import { PasswordResetService } from './password-reset.service';
import { EmailVerificationService } from './email-verification.service';
import { InviteAcceptanceService } from './invite-acceptance.service';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionsGuard } from './permissions.guard';
import { EmailModule } from '../email/email.module';

// Access-token lifetime. Kept short because there is no refresh-token rotation
// or server-side revocation yet, so this IS the full session length and a
// stolen token is valid until it expires. Expiry is now handled gracefully
// client-side (the web proxy + api client redirect to login instead of
// crashing), so raising this is a UX-vs-security tradeoff — do it together with
// refresh tokens, not alone.
const ACCESS_TOKEN_TTL = '1h';

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
