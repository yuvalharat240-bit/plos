import { Module } from '@nestjs/common';
import { createRemoteJWKSet } from 'jose';
import { DatabaseModule } from '../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { AuthController } from './auth.controller';
import { AppleIdentityService, APPLE_ISSUER, APPLE_JWKS_RESOLVER } from './apple-identity.service';
import { UserAccountService } from './user-account.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { PasskeyService } from './passkey.service';
import { AuthGuard } from './guards/auth.guard';
import { ScopeGuard } from './guards/scope.guard';
import { EntitlementGuard } from './guards/entitlement.guard';

@Module({
  // docs/09 Milestone 7 / gap-audit item 4: the unauthenticated auth
  // endpoints (sign-in, refresh, passkey login) — credential-stuffing/
  // refresh-token-brute-force/passkey-ceremony-spam surface with no user
  // identity yet to key a limit by — are now rate-limited via the
  // `ThrottlerGuard`s applied in AuthController, using the 'auth' named
  // throttler AppModule registers (`ThrottlerModule` is `@Global()` and
  // registered exactly once there — see that file's own comment for why
  // a second registration here silently broke throttling app-wide).
  imports: [DatabaseModule, AuditModule],
  controllers: [AuthController],
  providers: [
    {
      // The real, network-backed JWKS source (docs/09 Milestone 2 / ADR
      // D7). AppleIdentityService never imports this directly — see that
      // file's header for why, and the e2e test for the local-JWKS
      // substitute used to exercise the same verification code for real.
      provide: APPLE_JWKS_RESOLVER,
      useFactory: () => createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`)),
    },
    AppleIdentityService,
    UserAccountService,
    SessionService,
    TokenService,
    PasskeyService,
    AuthGuard,
    ScopeGuard,
    EntitlementGuard,
  ],
  exports: [AuthGuard, ScopeGuard, EntitlementGuard, TokenService],
})
export class AuthModule {}
