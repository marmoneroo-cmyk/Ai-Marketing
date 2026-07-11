import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { ok, passwordSchema, type ApiResponse } from '@brandpilot/core';
import { logger } from '@brandpilot/observability';
import { AuthService, type AuthResult } from './auth.service';
import { SessionService } from './session.service';
import { PasswordResetService } from './password-reset.service';
import { EmailVerificationService } from './email-verification.service';
import { InviteAcceptanceService, type InvitePreview, type AcceptInviteResult } from './invite-acceptance.service';
import { Public } from './public.decorator';
import { CurrentUser } from './current-user.decorator';
import type { AuthContext } from './jwt.strategy';
import { zodSchemaClass } from '../common/zod-validation.pipe';

const registerSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  name: z.string().min(1).max(200).optional(),
  orgName: z.string().min(1).max(200),
});
export class RegisterBody extends zodSchemaClass(registerSchema) {}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
  orgId: z.string().uuid().optional(),
});
class LoginBody extends zodSchemaClass(loginSchema) {}

// A refresh token is base64url(32 bytes) ≈ 43 chars; cap generously so the
// public, rate-limited endpoints reject oversized bodies before hashing.
const refreshSchema = z.object({
  refreshToken: z.string().min(1).max(512),
});
class RefreshBody extends zodSchemaClass(refreshSchema) {}

const logoutSchema = z.object({
  refreshToken: z.string().min(1).max(512),
});
class LogoutBody extends zodSchemaClass(logoutSchema) {}

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});
class ForgotPasswordBody extends zodSchemaClass(forgotPasswordSchema) {}

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});
class ResetPasswordBody extends zodSchemaClass(resetPasswordSchema) {}

const verifyEmailSchema = z.object({
  token: z.string().min(1),
});
class VerifyEmailBody extends zodSchemaClass(verifyEmailSchema) {}

const acceptInviteSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema.optional(),
  name: z.string().min(1).max(200).optional(),
});
class AcceptInviteBody extends zodSchemaClass(acceptInviteSchema) {}

/**
 * Authentication endpoints. Most routes are public (registration, login,
 * password reset, email verification); `@Public()` is applied per-route
 * rather than at the class level so `resend-verification` can require a valid
 * JWT (it falls through to the globally-registered JwtAuthGuard/
 * PermissionsGuard, same as any other protected route in the app).
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    private readonly passwordResetService: PasswordResetService,
    private readonly emailVerificationService: EmailVerificationService,
    private readonly inviteAcceptanceService: InviteAcceptanceService,
  ) {}

  @Post('register')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Register a new organization and its owner user' })
  async register(@Body() body: RegisterBody): Promise<ApiResponse<AuthResult>> {
    const result = await this.authService.register(body);

    // Fire-and-handle: a signup must succeed even if the verification email
    // hiccups (provider outage, transient error) — the user can always ask for
    // a resend once logged in. Log a warning rather than propagating, so a
    // failure here never turns into a failed registration response.
    try {
      await this.emailVerificationService.sendVerification(body.email);
    } catch (error: unknown) {
      logger.warn({ email: body.email, error }, 'failed to send verification email after registration');
    }

    return ok(result);
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Authenticate and receive a JWT access token' })
  async login(@Body() body: LoginBody): Promise<ApiResponse<AuthResult>> {
    const result = await this.authService.login(body);
    return ok(result);
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiOperation({ summary: 'Exchange a refresh token for a new access + refresh token pair' })
  async refresh(@Body() body: RefreshBody): Promise<ApiResponse<AuthResult>> {
    const result = await this.sessionService.rotate(body.refreshToken);
    return ok(result);
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiOperation({ summary: 'Revoke a refresh token (sign out)' })
  async logout(@Body() body: LogoutBody): Promise<ApiResponse<{ ok: true }>> {
    await this.sessionService.revoke(body.refreshToken);
    return ok({ ok: true });
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Request a password-reset email (always returns a generic response)' })
  async forgotPassword(@Body() body: ForgotPasswordBody): Promise<ApiResponse<{ ok: true }>> {
    // Always resolves and always returns the same generic response, whether or
    // not the email belongs to an account — anti-enumeration.
    await this.passwordResetService.requestPasswordReset(body.email);
    return ok({ ok: true });
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Consume a password-reset token and set a new password' })
  async resetPassword(@Body() body: ResetPasswordBody): Promise<ApiResponse<{ ok: true }>> {
    await this.passwordResetService.resetPassword(body.token, body.password);
    return ok({ ok: true });
  }

  @Post('verify-email')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Consume an email-verification token' })
  async verifyEmail(@Body() body: VerifyEmailBody): Promise<ApiResponse<{ ok: true }>> {
    await this.emailVerificationService.verifyEmail(body.token);
    return ok({ ok: true });
  }

  @Post('resend-verification')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @ApiOperation({ summary: "Resend the current user's verification email (always returns a generic response)" })
  async resendVerification(@CurrentUser() user: AuthContext): Promise<ApiResponse<{ ok: true }>> {
    await this.emailVerificationService.resendVerification(user.userId);
    return ok({ ok: true });
  }

  @Get('invite')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Preview a team invite before accepting it' })
  async getInvite(@Query('token') token?: string): Promise<ApiResponse<InvitePreview>> {
    const preview = await this.inviteAcceptanceService.previewInvite(token ?? '');
    return ok(preview);
  }

  @Post('accept-invite')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Accept a team invite, creating an account first if needed' })
  async acceptInvite(@Body() body: AcceptInviteBody): Promise<ApiResponse<AcceptInviteResult>> {
    const result = await this.inviteAcceptanceService.acceptInvite(body.token, body.password, body.name);
    return ok(result);
  }
}
