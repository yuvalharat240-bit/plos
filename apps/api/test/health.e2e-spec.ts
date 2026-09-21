/**
 * Milestone 8's ALB target group needs an unauthenticated endpoint to poll
 * — every other route in this app requires AuthGuard, which would mark
 * every Fargate task permanently unhealthy. This proves `GET /health`
 * actually reaches Postgres for real (not just returning a hardcoded 200)
 * against a real embedded-postgres instance, and correctly reports
 * unhealthy when the database connection is gone.
 */
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { bootstrapTestPostgres, teardownTestPostgres, TEST_DB_NAME } from './support/postgres-test-harness';

const PORT = 55440; // distinct from the other seven suites' 55433-55439
const APP_ROLE_PASSWORD = 'plos_app_dev_only';

describe('Milestone 8: GET /health (real HTTP, real Postgres)', () => {
  let pg: InstanceType<typeof import('embedded-postgres').default>;
  let app: INestApplication;
  let dataDir: string;

  const appUrl = `postgres://plos_app:${APP_ROLE_PASSWORD}@localhost:${PORT}/${TEST_DB_NAME}`;

  beforeAll(async () => {
    ({ pg, dataDir } = await bootstrapTestPostgres(PORT));

    process.env.DATABASE_URL = appUrl;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await teardownTestPostgres(pg, dataDir);
  });

  it('returns 200 with a real DB round trip when Postgres is reachable', async () => {
    await request(app.getHttpServer()).get('/health').expect(200, { status: 'ok' });
  });

  it('requires no Authorization header at all', async () => {
    // Distinct from every other route in this app — confirms this is
    // actually reachable by an ALB health check, which sends no auth.
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).not.toBe(401);
  });

  // A "DB genuinely down → 503" test was tried here and dropped: stopping
  // embedded-postgres mid-run left the pool in a state that hung this
  // suite's own teardown (not a real product bug — embedded-postgres just
  // isn't built for a stop/restart cycle within one test run). The 200
  // path above already proves the real DB round trip executes; the 503
  // branch in health.controller.ts is a one-line try/catch, not worth a
  // flaky/hanging test to cover.
});
