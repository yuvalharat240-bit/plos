import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { TenantDatabaseService } from '../../database/tenant-database.service';
import { REQUIRED_SCOPE_KEY } from '../decorators/required-scope.decorator';
import { readGrantedScopes } from '../read-granted-scopes';

/**
 * docs/03 §2.3's second guard. Runs strictly after AuthGuard (route
 * decorator order: `@UseGuards(AuthGuard, ScopeGuard, EntitlementGuard)`)
 * — depends on `request.requestContext.userId` already being set.
 *
 * Populates `requestContext.scopes` with every scope this user's own
 * first-party app currently holds (docs/09's real, documented
 * self_app-auto-grant-at-signup interpretation — see
 * UserAccountService.grantMvpSelfScopes), then denies the request if the
 * route's `@RequiredScope(...)` isn't among them. A route with no
 * `@RequiredScope()` metadata has nothing to check and passes through.
 */
@Injectable()
export class ScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: TenantDatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredScope = this.reflector.get<string | undefined>(
      REQUIRED_SCOPE_KEY,
      context.getHandler(),
    );

    const request = context.switchToHttp().getRequest<Request>();
    const requestContext = request.requestContext;
    if (!requestContext) {
      throw new Error('ScopeGuard used without AuthGuard running first');
    }

    const granted = await this.db.runAsUser(requestContext.userId, (client) =>
      readGrantedScopes(client, requestContext.userId),
    );
    requestContext.scopes = granted;

    if (requiredScope && !granted.includes(requiredScope)) {
      throw new ForbiddenException(`missing required scope: ${requiredScope}`);
    }
    return true;
  }
}
