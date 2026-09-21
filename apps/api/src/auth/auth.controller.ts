import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { TenantDatabaseService } from '../database/tenant-database.service';
import { AuditLogService } from '../audit/audit-log.service';
import { AppleIdentityService } from './apple-identity.service';
import { UserAccountService } from './user-account.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { PasskeyService } from './passkey.service';
import { AuthGuard } from './guards/auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { RequestContext } from './request-context';
import { AppleSignInDto } from './dto/apple-signin.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { PasskeyLoginVerifyDto, PasskeyRegisterVerifyDto } from './dto/passkey.dto';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  userId: string;
  isNew?: boolean;
}

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly db: TenantDatabaseService,
    private readonly auditLog: AuditLogService,
    private readonly appleIdentity: AppleIdentityService,
    private readonly userAccount: UserAccountService,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
    private readonly passkeys: PasskeyService,
  ) {}

  @Post('apple')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  async signInWithApple(@Body() dto: AppleSignInDto): Promise<TokenPair> {
    const identity = await this.appleIdentity.verifyIdentityToken(dto.identityToken);
    const user = await this.userAccount.findOrCreateByAppleSub(identity.appleSub, identity.email);

    const { sessionId, refreshToken } = await this.db.runAsUser(user.id, async (client) => {
      const session = await this.sessions.createSession(client, user.id, dto.deviceInfo);
      await this.auditLog.record(client, {
        actorType: 'user',
        actingAsUserId: user.id,
        action: user.isNew ? 'auth.apple.signup' : 'auth.apple.signin',
        resourceType: 'sessions',
        resourceId: session.sessionId,
        result: 'success',
      });
      return session;
    });

    const accessToken = await this.tokens.issueAccessToken({ userId: user.id, sessionId });
    return { accessToken, refreshToken, userId: user.id, isNew: user.isNew };
  }

  @Post('refresh')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  async refresh(@Body() dto: RefreshTokenDto): Promise<TokenPair> {
    const hash = this.sessions.hashToken(dto.refreshToken);
    const session = await this.db.runPreAuth((client) =>
      client
        .query('SELECT * FROM find_session_for_refresh($1)', [hash])
        .then((r) => r.rows[0] as { id: string; user_id: string } | undefined),
    );
    if (!session) {
      throw new UnauthorizedException('invalid or revoked refresh token');
    }

    const newRefreshToken = await this.db.runAsUser(session.user_id, async (client) => {
      const rotated = await this.sessions.rotateRefreshToken(client, session.id);
      await this.auditLog.record(client, {
        actorType: 'user',
        actingAsUserId: session.user_id,
        action: 'auth.refresh',
        resourceType: 'sessions',
        resourceId: session.id,
        result: 'success',
      });
      return rotated;
    });

    const accessToken = await this.tokens.issueAccessToken({
      userId: session.user_id,
      sessionId: session.id,
    });
    return { accessToken, refreshToken: newRefreshToken, userId: session.user_id };
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async logout(@CurrentUser() ctx: RequestContext): Promise<{ success: true }> {
    await this.db.runAsUser(ctx.userId, async (client) => {
      await this.sessions.revokeSession(client, ctx.sessionId, 'logout');
      await this.auditLog.record(client, {
        actorType: 'user',
        actingAsUserId: ctx.userId,
        action: 'auth.logout',
        resourceType: 'sessions',
        resourceId: ctx.sessionId,
        result: 'success',
      });
    });
    return { success: true };
  }

  @Post('passkey/register/options')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async passkeyRegisterOptions(@CurrentUser() ctx: RequestContext) {
    return this.db.runAsUser(ctx.userId, async (client) => {
      const user = await client.query('SELECT email FROM users WHERE id = $1', [ctx.userId]);
      const username: string = user.rows[0]?.email ?? ctx.userId;
      return this.passkeys.generateRegistration(client, ctx.userId, username);
    });
  }

  @Post('passkey/register/verify')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async passkeyRegisterVerify(
    @CurrentUser() ctx: RequestContext,
    @Body() dto: PasskeyRegisterVerifyDto,
  ): Promise<{ success: true }> {
    const { credentialId, publicKey } = await this.passkeys.verifyRegistration(
      dto.attemptId,
      ctx.userId,
      dto.response,
    );

    await this.db.runAsUser(ctx.userId, async (client) => {
      await client.query(
        `INSERT INTO webauthn_credentials (user_id, credential_id, public_key, device_name)
         VALUES ($1, $2, $3, $4)`,
        [ctx.userId, credentialId, publicKey, dto.deviceName ?? null],
      );
      await this.auditLog.record(client, {
        actorType: 'user',
        actingAsUserId: ctx.userId,
        action: 'auth.passkey.register',
        resourceType: 'webauthn_credentials',
        result: 'success',
      });
    });
    return { success: true };
  }

  @Post('passkey/login/options')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  async passkeyLoginOptions() {
    return this.passkeys.generateAuthentication();
  }

  @Post('passkey/login/verify')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  async passkeyLoginVerify(@Body() dto: PasskeyLoginVerifyDto): Promise<TokenPair> {
    const credentialId = this.passkeys.extractCredentialId(dto.response);
    const credential = await this.db.runPreAuth((client) =>
      client
        .query('SELECT * FROM find_webauthn_credential($1)', [credentialId])
        .then(
          (r) =>
            r.rows[0] as
              | { user_id: string; credential_id: Buffer; public_key: Buffer; sign_count: string }
              | undefined,
        ),
    );
    if (!credential) {
      throw new UnauthorizedException('unknown passkey credential');
    }

    const { newCounter } = await this.passkeys.verifyAuthentication(dto.attemptId, dto.response, {
      credentialId: credential.credential_id,
      publicKey: credential.public_key,
      signCount: Number(credential.sign_count),
    });

    const storedCount = Number(credential.sign_count);
    // FINDING (security review, docs/09 Milestone 7): the original
    // condition was `newCounter <= storedCount && newCounter !== 0`,
    // which drops the whole check whenever the NEW counter alone is
    // zero — a cloned/replayed authenticator asserting newCounter=0
    // against a real, already-nonzero storedCount (e.g. 5) skipped
    // clone detection entirely (0 <= 5 is true, but the check never ran
    // because 0 !== 0 is false). The legitimate exception is an
    // authenticator that has NEVER supported counters — both stored and
    // new are 0 — not merely a new value of 0.
    if (newCounter <= storedCount && !(newCounter === 0 && storedCount === 0)) {
      // A non-advancing counter (excluding the legitimate always-zero
      // case some authenticators report on every assertion) suggests a
      // cloned authenticator — fail closed rather than silently accept it.
      throw new ForbiddenException('passkey signature counter did not advance');
    }

    const { sessionId, refreshToken } = await this.db.runAsUser(
      credential.user_id,
      async (client) => {
        await client.query(
          `UPDATE webauthn_credentials SET sign_count = $1, last_used_at = now() WHERE credential_id = $2`,
          [newCounter, credential.credential_id],
        );
        const session = await this.sessions.createSession(client, credential.user_id);
        await this.auditLog.record(client, {
          actorType: 'user',
          actingAsUserId: credential.user_id,
          action: 'auth.passkey.signin',
          resourceType: 'sessions',
          resourceId: session.sessionId,
          result: 'success',
        });
        return session;
      },
    );

    const accessToken = await this.tokens.issueAccessToken({
      userId: credential.user_id,
      sessionId,
    });
    return { accessToken, refreshToken, userId: credential.user_id };
  }
}
