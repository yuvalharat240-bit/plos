import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * docs/06-threat-model.md T9's must-fix: "per-user/session application-
 * level rate limit on /v1/agent/ask — direct dollar-cost exposure per
 * call, not just a security nicety." The AWS edge's WAF/ALB limiting
 * (docs/03 §2.2) is coarse and IP-based; this is the missing per-
 * authenticated-user layer, tracked by `RequestContext.userId` (set by
 * AuthGuard, which must run before this guard in the route's
 * `@UseGuards(...)` order) rather than the default IP tracker, so sharing
 * a NAT/proxy IP never falsely throttles unrelated users and a single
 * compromised session is bounded regardless of how many IPs it uses from.
 */
@Injectable()
export class AgentAskThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.requestContext?.userId ?? req.ip;
  }
}
