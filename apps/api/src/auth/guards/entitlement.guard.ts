import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';

/**
 * docs/03 §2.3's third guard, present per docs/08 §9.2 as "a pass-through
 * stage, gating nothing" — RevenueCat (ADR D8) isn't integrated yet, so
 * there is no entitlement tier to actually check. It still runs, in the
 * documented pipeline order, and fills in the RequestContext field so
 * the shape is real even though the value is a placeholder.
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.requestContext) {
      request.requestContext.entitlementTier = 'unconfigured';
    }
    return true;
  }
}
