/**
 * Milestone 3 (docs/09-phase1-implementation-plan.md) verification: real
 * HTTP against the real AppModule + real embedded Postgres, same harness
 * shape as test/auth-and-crud.e2e-spec.ts. The one behavior that's new
 * and load-bearing here — not covered by any Milestone 2 test — is
 * idempotency: HealthKit/EventKit sync is client-driven and can
 * legitimately resend the same sample, so re-syncing must produce zero
 * new rows, not duplicates or an error.
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import { AppModule } from '../src/app.module';
import { APPLE_JWKS_RESOLVER, APPLE_ISSUER } from '../src/auth/apple-identity.service';
import { bootstrapTestPostgres, teardownTestPostgres, testSuperuserUrl, TEST_DB_NAME } from './support/postgres-test-harness';

const PORT = 55435; // distinct from the other two suites' 55433/55434
const APP_ROLE_PASSWORD = 'plos_app_dev_only';

describe('Milestone 3: HealthKit + Calendar sync (real HTTP, real Postgres)', () => {
  let pg: InstanceType<typeof import('embedded-postgres').default>;
  let superuserClient: Client;
  let app: INestApplication;
  let dataDir: string;
  let accessToken: string;
  let userId: string;

  const appUrl = `postgres://plos_app:${APP_ROLE_PASSWORD}@localhost:${PORT}/${TEST_DB_NAME}`;

  beforeAll(async () => {
    ({ pg, dataDir } = await bootstrapTestPostgres(PORT));

    superuserClient = new Client({ connectionString: testSuperuserUrl(PORT) });
    await superuserClient.connect();

    process.env.DATABASE_URL = appUrl;

    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'test-key-1';
    jwk.alg = 'RS256';
    const localJwks = createLocalJWKSet({ keys: [jwk] });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APPLE_JWKS_RESOLVER)
      .useValue(localJwks)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    const idToken = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setIssuer(APPLE_ISSUER)
      .setAudience('com.plos.app.not-yet-configured')
      .setSubject('apple-sub-milestone3')
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);
    const signIn = await request(app.getHttpServer())
      .post('/v1/auth/apple')
      .send({ identityToken: idToken })
      .expect(200);
    accessToken = signIn.body.accessToken;
    userId = signIn.body.userId;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await superuserClient?.end();
    await teardownTestPostgres(pg, dataDir);
  });

  describe('Health sync', () => {
    const healthPayload = {
      sleepSamples: [
        {
          sourceId: 'hk-sleep-001',
          sleepStart: '2026-09-20T23:00:00.000Z',
          sleepEnd: '2026-09-21T06:30:00.000Z',
          durationMin: 450,
        },
      ],
      vitalSamples: [
        {
          sourceId: 'hk-hr-001',
          vitalType: 'resting_hr',
          valueNumeric: 58,
          unit: 'bpm',
          observedAt: '2026-09-21T07:00:00.000Z',
        },
      ],
      workouts: [
        {
          sourceId: 'hk-workout-001',
          sportType: 'run',
          startsAt: '2026-09-21T08:00:00.000Z',
          endsAt: '2026-09-21T08:30:00.000Z',
          durationMin: 30,
          calories: 280,
        },
      ],
    };

    it('syncs sleep, vital, and workout samples into real, correctly-provenanced rows', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/sync/health')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(healthPayload)
        .expect(200);
      expect(res.body).toEqual({ inserted: 3, skipped: 0 });

      const sleep = await superuserClient.query(
        `SELECT co.is_imported, co.provider, co.source_id, s.duration_min
         FROM core_objects co JOIN observation_sleep s ON s.observation_id = co.id
         WHERE co.source_id = 'hk-sleep-001'`,
      );
      expect(sleep.rows[0].is_imported).toBe(true);
      expect(sleep.rows[0].provider).toBe('healthkit');
      expect(sleep.rows[0].duration_min).toBe(450);

      const vital = await superuserClient.query(
        `SELECT co.is_imported, co.provider, v.vital_type, v.value_numeric
         FROM core_objects co JOIN observation_vital v ON v.observation_id = co.id
         WHERE co.source_id = 'hk-hr-001'`,
      );
      expect(vital.rows[0].is_imported).toBe(true);
      expect(vital.rows[0].vital_type).toBe('resting_hr');
      expect(Number(vital.rows[0].value_numeric)).toBe(58);

      const workout = await superuserClient.query(
        `SELECT co.is_imported, co.provider, e.domain, f.sport_type
         FROM core_objects co
         JOIN events e ON e.id = co.id
         JOIN event_fitness_session f ON f.event_id = e.id
         WHERE co.source_id = 'hk-workout-001'`,
      );
      expect(workout.rows[0].is_imported).toBe(true);
      expect(workout.rows[0].domain).toBe('fitness');
      expect(workout.rows[0].sport_type).toBe('run');
    });

    it('re-syncing the exact same samples is idempotent — zero new rows, not duplicates or an error', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/sync/health')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(healthPayload)
        .expect(200);
      expect(res.body).toEqual({ inserted: 0, skipped: 3 });

      const count = await superuserClient.query(
        `SELECT count(*)::int AS n FROM core_objects WHERE source_id IN ('hk-sleep-001','hk-hr-001','hk-workout-001')`,
      );
      expect(count.rows[0].n).toBe(3);
    });

    it('rejects an unrecognized vitalType (400, not a raw Postgres CHECK violation)', async () => {
      await request(app.getHttpServer())
        .post('/v1/sync/health')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          vitalSamples: [
            { sourceId: 'hk-hr-002', vitalType: 'made_up_type', valueNumeric: 1, unit: 'x', observedAt: '2026-09-21T07:00:00.000Z' },
          ],
        })
        .expect(400);
    });

    it('rejects sync when health.write has been revoked', async () => {
      await superuserClient.query(
        `UPDATE permission_grants SET revoked_at = now() WHERE user_id = $1 AND scope = 'health.write'`,
        [userId],
      );
      await request(app.getHttpServer())
        .post('/v1/sync/health')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ vitalSamples: [] })
        .expect(403);
      await superuserClient.query(
        `UPDATE permission_grants SET revoked_at = NULL WHERE user_id = $1 AND scope = 'health.write'`,
        [userId],
      );
    });
  });

  describe('Calendar sync', () => {
    const calendarPayload = {
      events: [
        {
          sourceId: 'ek-event-001',
          startsAt: '2026-09-21T14:00:00.000Z',
          endsAt: '2026-09-21T15:00:00.000Z',
          attendeeCount: 3,
          isFocusBlock: false,
        },
      ],
    };

    it('syncs a calendar event with no title stored (density signal, not content)', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/sync/calendar')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(calendarPayload)
        .expect(200);
      expect(res.body).toEqual({ inserted: 1, skipped: 0 });

      const row = await superuserClient.query(
        `SELECT e.title, e.domain, c.attendee_count, c.is_focus_block
         FROM events e JOIN event_calendar_item c ON c.event_id = e.id
         WHERE c.external_event_id = 'ek-event-001'`,
      );
      expect(row.rows[0].title).toBeNull();
      expect(row.rows[0].domain).toBe('productivity');
      expect(row.rows[0].attendee_count).toBe(3);
      expect(row.rows[0].is_focus_block).toBe(false);
    });

    it('re-syncing the same calendar event is idempotent', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/sync/calendar')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(calendarPayload)
        .expect(200);
      expect(res.body).toEqual({ inserted: 0, skipped: 1 });
    });
  });
});
