import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JWTVerifyGetKey, jwtVerify } from 'jose';

export const APPLE_JWKS_RESOLVER = Symbol('APPLE_JWKS_RESOLVER');
export const APPLE_ISSUER = 'https://appleid.apple.com';

export interface AppleIdentity {
  appleSub: string;
  email?: string;
}

/**
 * docs/09 Milestone 2 / ADR D7: verifies the Sign in with Apple identity
 * token (a JWT Apple signs, handed to us by the client after Apple's own
 * on-device auth). Real verification — signature against Apple's current
 * JWKS, issuer, audience, expiry — not a decode-and-trust.
 *
 * The JWKS source is injected (APPLE_JWKS_RESOLVER) rather than hardcoded
 * to `createRemoteJWKSet` so tests can substitute a local JWKS built from
 * a test keypair and exercise this exact verification code against a
 * self-signed "Apple" token, instead of mocking verification away. See
 * AuthModule for the real (remote) provider and the e2e test for the
 * local one.
 *
 * expectedAudience must equal the Sign in with Apple Service ID / app
 * bundle ID configured in the Apple Developer account — not yet
 * provisioned in this environment (CLAUDE.md's iOS "Known open items").
 * Until that's real, APPLE_AUDIENCE is a placeholder and this path
 * cannot be exercised against a genuine Apple-issued token — only against
 * the injected-JWKS test path, which is real verification of real code,
 * just not yet pointed at the real Apple service.
 */
@Injectable()
export class AppleIdentityService {
  constructor(@Inject(APPLE_JWKS_RESOLVER) private readonly getKey: JWTVerifyGetKey) {}

  async verifyIdentityToken(idToken: string): Promise<AppleIdentity> {
    const expectedAudience = process.env.APPLE_AUDIENCE ?? 'com.plos.app.not-yet-configured';
    try {
      const { payload } = await jwtVerify(idToken, this.getKey, {
        issuer: APPLE_ISSUER,
        audience: expectedAudience,
      });
      if (typeof payload.sub !== 'string') {
        throw new Error('Apple identity token missing sub');
      }
      return {
        appleSub: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : undefined,
      };
    } catch {
      throw new UnauthorizedException('invalid Apple identity token');
    }
  }
}
