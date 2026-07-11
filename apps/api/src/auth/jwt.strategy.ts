import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { loadEnv } from '@brandpilot/config';
import { ROLES, type Role } from '@brandpilot/core';

/** Shape of the JWT payload we sign at login. */
export interface JwtPayload {
  sub: string; // userId
  orgId: string;
  role: Role;
}

/** Request-scoped auth context attached to `req.user` after validation. */
export interface AuthContext {
  userId: string;
  orgId: string;
  role: Role;
}

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * Validates the bearer access token and maps it to a typed AuthContext. The
 * secret comes from the validated env (AUTH_SECRET).
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: loadEnv().AUTH_SECRET,
    });
  }

  validate(payload: JwtPayload): AuthContext {
    if (!payload?.sub || !payload.orgId || !isRole(payload.role)) {
      throw new UnauthorizedException('Malformed access token');
    }
    return { userId: payload.sub, orgId: payload.orgId, role: payload.role };
  }
}
