import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from './database/database.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { JournalModule } from './journal/journal.module';
import { WorkoutsModule } from './workouts/workouts.module';
import { MedicationsModule } from './medications/medications.module';
import { SyncModule } from './sync/sync.module';
import { AgentModule } from './agent/agent.module';
import { PrivacyModule } from './privacy/privacy.module';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
  imports: [
    DatabaseModule,
    AuditModule,
    // The ONE `ThrottlerModule` registration for the whole app —
    // `@nestjs/throttler`'s dynamic module is `@Global()`, so registering
    // it more than once (Milestone 5 registered it in AgentModule,
    // Milestone 7 initially added a second one in AuthModule) silently
    // breaks throttling app-wide instead of erroring — found for real
    // when Milestone 7's own auth-endpoint rate limit made an unrelated,
    // already-passing agent-module test start failing with a 500. Two
    // named throttlers, each read lazily via `forRootAsync` (not
    // `forRoot`'s eager object literal) so a test's `beforeAll` can still
    // override the env vars before Nest actually instantiates this
    // provider — every route is isolated by its own
    // class+handler+throttler-name+tracker cache key regardless of
    // shared config names (`@nestjs/throttler`'s own `generateKey`), so
    // AgentAskThrottlerGuard (per-user tracker, `agentAsk` config) and
    // the plain `ThrottlerGuard` on auth endpoints (default per-IP
    // tracker, `auth` config) never share state despite both existing
    // under one registration.
    ThrottlerModule.forRootAsync({
      useFactory: () => [
        {
          name: 'auth',
          ttl: Number(process.env.PLOS_AUTH_RATE_TTL_MS ?? 60_000),
          limit: Number(process.env.PLOS_AUTH_RATE_LIMIT ?? 10),
        },
        {
          name: 'agentAsk',
          ttl: Number(process.env.PLOS_AGENT_ASK_RATE_TTL_MS ?? 60_000),
          limit: Number(process.env.PLOS_AGENT_ASK_RATE_LIMIT ?? 20),
        },
      ],
    }),
    AuthModule,
    UsersModule,
    JournalModule,
    WorkoutsModule,
    MedicationsModule,
    SyncModule,
    AgentModule,
    PrivacyModule,
  ],
})
export class AppModule {}
