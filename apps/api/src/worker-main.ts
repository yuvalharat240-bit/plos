import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker/worker.module';
import { BaselineService } from './worker/baseline.service';
import { CalendarDensityService } from './worker/calendar-density.service';
import { TenantDatabaseService } from './database/tenant-database.service';

/**
 * docs/03-system-architecture.md §2.5 / docs/09 Milestone 4: the
 * `worker` Fargate task. Run here as a standalone headless process (no
 * HTTP listener, `NestFactory.createApplicationContext` not
 * `NestFactory.create`) sharing `apps/api`'s codebase and providers
 * rather than a genuinely separate deployable — Milestone 8 is what
 * actually stands up a distinct Fargate task; until then this matches
 * the plan's own framing ("a scheduled job, nightly is enough — no need
 * for real-time recompute"): invoke it once (`npm run worker`), let an
 * external scheduler (cron for now, EventBridge later) call it again
 * tomorrow, and exit — not a long-running process.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('worker-main');
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const db = app.get(TenantDatabaseService);
  const baselineService = app.get(BaselineService);
  const calendarDensityService = app.get(CalendarDensityService);

  // `users` has no RLS by design (docs/04 §7.1) — enumerating who exists
  // at all is exactly `runPreAuth`'s third documented use (see that
  // method's own comment). Every actual metric computation below still
  // goes through `runAsUser`, one fresh transaction per user.
  const userIds = await db.runPreAuth((client) =>
    client
      .query(`SELECT id FROM users WHERE status = 'active'`)
      .then((r) => r.rows.map((row) => row.id as string)),
  );

  logger.log(`Computing baselines for ${userIds.length} active user(s)`);
  let totalWritten = 0;
  let totalSkipped = 0;
  for (const userId of userIds) {
    const { written, skipped } = await baselineService.computeForUser(userId);
    totalWritten += written;
    totalSkipped += skipped;
    await calendarDensityService.computeForUser(userId);
  }
  logger.log(
    `Done: ${totalWritten} baseline row(s) written, ${totalSkipped} metric(s) skipped for insufficient data, across ${userIds.length} user(s).`,
  );

  await app.close();
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[worker-main] fatal error', err);
  process.exit(1);
});
