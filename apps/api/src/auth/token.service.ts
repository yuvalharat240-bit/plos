import { Injectable, UnauthorizedException } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // docs/03 §2.3: "15-minute lifetime, ADR D7"
const ISSUER = 'plos-api';

export interface AccessTokenPayload {
  userId: string;
  sessionId: string;
}

/**
 * Issues and verifies plos's OWN access tokens — distinct from the Apple
 * identity token, which AppleIdentityService verifies separately and only
 * once, at sign-in. This is a plain symmetric (HS256) JWT since only this
 * one backend service ever needs to verify it.
 *
 * Secret comes from JWT_ACCESS_SECRET. No production default is baked in
 * on purpose — Milestone 8 provisions the real value via Secrets Manager
 * (ADR D4); the fallback below is a fixed, clearly-dev-only string so
 * local/test runs work without extra setup, matching the existing
 * dev-only DB passwords in 001_roles_and_extensions.js.
 */
@Injectable()
export class TokenService {
  private readonly secret = new TextEncoder().encode(
    process.env.JWT_ACCESS_SECRET ?? 'plos_access_token_dev_only_secret',
  );

  async issueAccessToken(payload: AccessTokenPayload): Promise<string> {
    return new SignJWT({ sid: payload.sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(payload.userId)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(this.secret);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    try {
      const { payload } = await jwtVerify(token, this.secret, { issuer: ISSUER });
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
        throw new Error('malformed access token payload');
      }
      return { userId: payload.sub, sessionId: payload.sid };
    } catch {
      throw new UnauthorizedException('invalid or expired access token');
    }
  }
}
