import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { TenantDatabaseService } from './database/tenant-database.service';

/**
 * Unauthenticated liveness/readiness target for Milestone 8's ALB target
 * group — every other route in this app requires AuthGuard, which would
 * mark every Fargate task permanently unhealthy. Checks real DB
 * connectivity (via the same `runPreAuth` path migrations/pre-auth routes
 * already use) rather than just returning 200 unconditionally, so a task
 * that can't reach RDS gets cycled instead of serving traffic it can't
 * actually handle.
 */
@Controller()
export class HealthController {
  constructor(private readonly db: TenantDatabaseService) {}

  @Get('health')
  async health(): Promise<{ status: 'ok' }> {
    try {
      await this.db.runPreAuth((client) => client.query('SELECT 1'));
    } catch {
      throw new ServiceUnavailableException('database unreachable');
    }
    return { status: 'ok' };
  }
}
