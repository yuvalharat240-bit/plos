import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { TokenService } from '../token.service';
import { TenantDatabaseService } from '../../database/tenant-database.service';

/**
 * docs/03 §2.3, first of the three request-pipeline guards: verifies the
 * access JWT AND confirms the backing `sessions` row hasn't been revoked
 * (a live DB check, not just JWT expiry — the doc is explicit about this,
 * since a stateless JWT alone can't reflect an interim logout/revocation
 * within its own 15-minute lifetime).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly tokenService: TokenService,
    private readonly db: TenantDatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing bearer token');
    }

    const { userId, sessionId } = await this.tokenService.verifyAccessToken(
      header.slice('Bearer '.length),
    );

    const session = await this.db.runAsUser(userId, (client) =>
      client
        .query('SELECT revoked_at FROM sessions WHERE id = $1 AND user_id = $2', [
          sessionId,
          userId,
        ])
        .then((r) => r.rows[0] as { revoked_at: Date | null } | undefined),
    );
    if (!session || session.revoked_at) {
      throw new UnauthorizedException('session revoked or not found');
    }

    request.requestContext = { userId, sessionId, scopes: [], entitlementTier: 'unset' };
    return true;
  }
}
