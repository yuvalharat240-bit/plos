/**
 * Milestone 6 (docs/09-phase1-implementation-plan.md) verification, its
 * exact stated bar: "export produces a real, downloadable bundle
 * matching the reduced folder set; account deletion actually removes/
 * anonymizes rows end-to-end, re-verified against the same RLS test from
 * Milestone 1" (i.e. a second user's data must be provably untouched).
 * Real HTTP against real embedded Postgres, same harness shape as every
 * other suite in this project — no ModelProvider override needed since
 * this suite never touches `/v1/agent/*`.
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { runner } from 'node-pg-migrate';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet, KeyLike } from 'jose';
import { AppModule } from '../src/app.module';
import { APPLE_JWKS_RESOLVER, APPLE_ISSUER } from '../src/auth/apple-identity.service';

const PORT = 55438; // distinct from the other five suites' 55433-55437
const DB_NAME = 'plos_test';
const SUPERUSER = 'postgres';
const SUPERUSER_PASSWORD = 'postgres_test_only';
const APP_ROLE_PASSWORD = 'plos_app_dev_only';

describe('Milestone 6: Privacy & data-control (real HTTP, real Postgres)', () => {
  let pg: InstanceType<typeof import('embedded-postgres').default>;
  let superuserClient: Client;
  let app: INestApplication;
  let dataDir: string;
  let privateKey: KeyLike;

  const superuserUrl = `postgres://${SUPERUSER}:${SUPERUSER_PASSWORD}@localhost:${PORT}/${DB_NAME}`;
  const appUrl = `postgres://plos_app:${APP_ROLE_PASSWORD}@localhost:${PORT}/${DB_NAME}`;

  beforeAll(async () => {
    // This suite signs in ~9 distinct users across its sub-describes —
    // right at the production 'auth' throttler's default limit (10/min
    // per IP) if left unset, since every sign-in in one test file shares
    // the same supertest-local IP. Same "override before compiling the
    // testing module" pattern as agent.e2e-spec.ts's own rate-limit test.
    process.env.PLOS_AUTH_RATE_LIMIT = '1000';

    const dynamicImport = new Function(
      'specifier',
      'return import(specifier)',
    ) as (specifier: string) => Promise<{ default: typeof import('embedded-postgres').default }>;
    const { default: EmbeddedPostgres } = await dynamicImport('embedded-postgres');
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plos-pg-m6-'));

    pg = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: SUPERUSER,
      password: SUPERUSER_PASSWORD,
      port: PORT,
      persistent: false,
    });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase(DB_NAME);

    try {
      await runner({
        databaseUrl: superuserUrl,
        dir: path.join(__dirname, '..', 'migrations'),
        direction: 'up',
        migrationsTable: 'pgmigrations',
        singleTransaction: false,
        log: () => {},
      });
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      if (!/extension "vector"|vector\.control|could not open extension control file/i.test(message)) {
        throw err;
      }
    }

    superuserClient = new Client({ connectionString: superuserUrl });
    await superuserClient.connect();

    process.env.DATABASE_URL = appUrl;
    process.env.PLOS_LOCAL_OBJECT_STORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'plos-export-store-'));

    const { publicKey, privateKey: signingKey } = await generateKeyPair('RS256');
    privateKey = signingKey;
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'test-key-1';
    jwk.alg = 'RS256';
    const localJwks = createLocalJWKSet({ keys: [jwk] });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APPLE_JWKS_RESOLVER)
      .useValue(localJwks)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await superuserClient?.end();
    await pg?.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(process.env.PLOS_LOCAL_OBJECT_STORE_DIR!, { recursive: true, force: true });
  });

  async function signIn(sub: string): Promise<{ accessToken: string; userId: string }> {
    const idToken = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setIssuer(APPLE_ISSUER)
      .setAudience('com.plos.app.not-yet-configured')
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);
    const res = await request(app.getHttpServer()).post('/v1/auth/apple').send({ identityToken: idToken }).expect(200);
    return { accessToken: res.body.accessToken, userId: res.body.userId };
  }

  describe('Consent (docs/07 §4.1)', () => {
    let accessToken: string;
    let userId: string;

    beforeAll(async () => {
      ({ accessToken, userId } = await signIn('apple-sub-m6-consent'));
    });

    it('lists all three MVP consent types as implicitly granted for a fresh self-signup user', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/privacy/consents')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(res.body).toHaveLength(3);
      expect(res.body.every((c: { granted: boolean }) => c.granted)).toBe(true);
    });

    it('revoking health_data_processing really revokes health.*/fitness.* scopes, not just the consent row', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/privacy/consents/revoke')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ consentType: 'health_data_processing' })
        .expect(200);
      expect(res.body.triggeredDeletion).toBe(false);

      const grants = await request(app.getHttpServer())
        .get('/v1/privacy/grants')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      const scopes = grants.body.map((g: { scope: string }) => g.scope);
      expect(scopes).not.toEqual(expect.arrayContaining(['health.read', 'health.write', 'fitness.write']));
      // Unaffected domain's scope survives.
      expect(scopes).toEqual(expect.arrayContaining(['mental_health.write']));

      // The real, structural consequence: a health-scoped endpoint now 403s.
      await request(app.getHttpServer())
        .post('/v1/sync/health')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ vitalSamples: [] })
        .expect(403);
    });

    it('directly revoking a specific permission grant blocks its endpoint (agent.ask)', async () => {
      await request(app.getHttpServer())
        .post('/v1/privacy/grants/revoke')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ scope: 'agent.ask' })
        .expect(200);

      await request(app.getHttpServer())
        .post('/v1/agent/ask')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ question: 'anything' })
        .expect(403);
    });

    it('revoking tos treats it as an account-deletion trigger, not a feature toggle', async () => {
      const { accessToken: tosToken, userId: tosUserId } = await signIn('apple-sub-m6-tos');
      const res = await request(app.getHttpServer())
        .post('/v1/privacy/consents/revoke')
        .set('Authorization', `Bearer ${tosToken}`)
        .send({ consentType: 'tos' })
        .expect(200);
      expect(res.body.triggeredDeletion).toBe(true);

      const status = await superuserClient.query(`SELECT status FROM users WHERE id = $1`, [tosUserId]);
      expect(status.rows[0].status).toBe('pending_deletion');
    });
  });

  describe('Data export bundle (docs/07 §8, reduced MVP folder set)', () => {
    let accessToken: string;
    let userId: string;

    beforeAll(async () => {
      ({ accessToken, userId } = await signIn('apple-sub-m6-export'));
      await superuserClient.query(
        `INSERT INTO baselines (user_id, domain, metric, window_days, mean, stddev, current_value, deviation_z, classification, source)
         VALUES ($1, 'fitness', 'training_load', 14, 60, 10, 65, 0.5, 'normal', 'context_engine_worker')`,
        [userId],
      );
      await request(app.getHttpServer())
        .post('/v1/journal')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ entryKind: 'free_text', entryText: 'a private thought', tags: [] })
        .expect(201);
    });

    it('produces a real, downloadable ZIP with the reduced MVP folder set, excluding mental_health/ by default', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/privacy/export')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(200);
      expect(res.body.sections).toEqual(['profile', 'goals', 'health', 'fitness', 'memories', 'ai', 'audit']);
      expect(typeof res.body.downloadUrl).toBe('string');

      const download = await request(app.getHttpServer())
        .get(res.body.downloadUrl)
        .buffer(true)
        .parse((downloadRes, callback) => {
          const chunks: Buffer[] = [];
          downloadRes.on('data', (chunk: Buffer) => chunks.push(chunk));
          downloadRes.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(download.headers['content-type']).toBe('application/zip');
      // A real ZIP's local file header signature — proof this is an
      // actual archive, not just an opaque blob.
      const bytes = download.body as Buffer;
      expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

      const doc = await superuserClient.query(
        `SELECT document_type, mime_type FROM documents WHERE user_id = $1 AND document_type = 'export_bundle'`,
        [userId],
      );
      expect(doc.rows).toHaveLength(1);
      expect(doc.rows[0].mime_type).toBe('application/zip');
    });

    it('requires a two-step confirmation before including mental_health/, and excludes it if declined', async () => {
      const requested = await request(app.getHttpServer())
        .post('/v1/privacy/export')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ includeMentalHealth: true })
        .expect(200);
      expect(requested.body.status).toBe('confirmation_required');
      expect(typeof requested.body.confirmationToken).toBe('string');

      const confirmed = await request(app.getHttpServer())
        .post('/v1/privacy/export')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ includeMentalHealth: true, confirmationToken: requested.body.confirmationToken })
        .expect(200);
      expect(confirmed.body.sections).toEqual(
        expect.arrayContaining(['mental_health']),
      );

      // Replay must fail — same single-use guarantee as the agent's own
      // Tier 2+ confirmation tokens (Milestone 5).
      const replay = await request(app.getHttpServer())
        .post('/v1/privacy/export')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ includeMentalHealth: true, confirmationToken: requested.body.confirmationToken })
        .expect(200);
      expect(replay.body.status).toBe('denied');
    });
  });

  describe('Account deletion (docs/07 §7, full 8-step workflow)', () => {
    it('grace-period request revokes integrations/sessions immediately without deleting data, and can be cancelled', async () => {
      const { accessToken, userId } = await signIn('apple-sub-m6-grace');
      await request(app.getHttpServer())
        .post('/v1/sync/calendar')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ events: [{ sourceId: 'ek-grace-1', startsAt: new Date().toISOString() }] })
        .expect(200);
      await superuserClient.query(
        `INSERT INTO webauthn_credentials (user_id, credential_id, public_key, device_name) VALUES ($1, $2, $3, 'Test Device')`,
        [userId, Buffer.from('grace-period-credential-id'), Buffer.from('fake-public-key')],
      );

      const res = await request(app.getHttpServer())
        .post('/v1/privacy/account/delete')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(200);
      expect(res.body.status).toBe('pending_deletion');
      expect(res.body.deletionEligibleAt).toBeTruthy();

      const userRow = await superuserClient.query(`SELECT status FROM users WHERE id = $1`, [userId]);
      expect(userRow.rows[0].status).toBe('pending_deletion');
      const integrations = await superuserClient.query(
        `SELECT status FROM integrations WHERE user_id = $1 AND provider = 'apple_calendar'`,
        [userId],
      );
      expect(integrations.rows[0].status).toBe('revoked');
      // Steps 3-8 have NOT run yet.
      const events = await superuserClient.query(`SELECT count(*)::int AS n FROM events WHERE user_id = $1`, [userId]);
      expect(events.rows[0].n).toBe(1);
      // docs/09 Milestone 7 finding: a cancellable request must not
      // permanently destroy the passkey credential — only session
      // revocation is immediate; credential deletion waits for finalize.
      const credentials = await superuserClient.query(
        `SELECT count(*)::int AS n FROM webauthn_credentials WHERE user_id = $1`,
        [userId],
      );
      expect(credentials.rows[0].n).toBe(1);

      // Requesting deletion revoked every session (step 2), including the
      // one behind `accessToken` — by design ("forces re-auth on next
      // refresh attempt"). Cancelling therefore needs a fresh sign-in
      // first, the same way a real user would see "deletion scheduled,
      // cancel?" only after signing back in during the grace window.
      const resigned = await signIn('apple-sub-m6-grace');
      await request(app.getHttpServer())
        .post('/v1/privacy/account/delete/cancel')
        .set('Authorization', `Bearer ${resigned.accessToken}`)
        .send({})
        .expect(200);
      const afterCancel = await superuserClient.query(`SELECT status FROM users WHERE id = $1`, [userId]);
      expect(afterCancel.rows[0].status).toBe('active');
    });

    it('immediate deletion removes/anonymizes everything end-to-end, with zero cross-tenant impact on a second user', async () => {
      const userA = await signIn('apple-sub-m6-delete-a');
      const userB = await signIn('apple-sub-m6-delete-b');

      for (const { accessToken } of [userA, userB]) {
        await request(app.getHttpServer())
          .post('/v1/journal')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ entryKind: 'free_text', entryText: 'entry', tags: [] })
          .expect(201);
        await request(app.getHttpServer())
          .post('/v1/workouts')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ sportType: 'run', startsAt: new Date().toISOString() })
          .expect(201);
      }
      await superuserClient.query(
        `INSERT INTO baselines (user_id, domain, metric, window_days, mean, stddev, current_value, deviation_z, classification, source)
         VALUES ($1, 'fitness', 'training_load', 14, 60, 10, 65, 0.5, 'normal', 'context_engine_worker')`,
        [userA.userId],
      );

      // docs/09 Milestone 7 finding: 'relationship' and 'outcome' spine
      // rows were never included in the deletion sweep — seed one of
      // each so this test actually exercises that fix instead of
      // trivially passing because nothing of that type existed.
      const actionSpine = await superuserClient.query(
        `INSERT INTO core_objects (user_id, object_type, source) VALUES ($1, 'action', 'test_seed') RETURNING id`,
        [userA.userId],
      );
      const actionId = actionSpine.rows[0].id;
      await superuserClient.query(
        `INSERT INTO actions (id, user_id, domain, action_type, executed_by, risk_tier, status) VALUES ($1, $2, 'fitness', 'workout_cancellation', 'user', 2, 'completed')`,
        [actionId, userA.userId],
      );
      const outcomeSpine = await superuserClient.query(
        `INSERT INTO core_objects (user_id, object_type, source) VALUES ($1, 'outcome', 'test_seed') RETURNING id`,
        [userA.userId],
      );
      await superuserClient.query(
        `INSERT INTO outcomes (id, user_id, outcome_of_id, outcome_type, measured_at) VALUES ($1, $2, $3, 'recovery', now())`,
        [outcomeSpine.rows[0].id, userA.userId, actionId],
      );
      const entitySpine = await superuserClient.query(
        `INSERT INTO core_objects (user_id, object_type, source) VALUES ($1, 'entity', 'test_seed') RETURNING id`,
        [userA.userId],
      );
      await superuserClient.query(
        `INSERT INTO entities (id, user_id, entity_type, display_name) VALUES ($1, $2, 'person', 'Test Person')`,
        [entitySpine.rows[0].id, userA.userId],
      );
      const relationshipSpine = await superuserClient.query(
        `INSERT INTO core_objects (user_id, object_type, source) VALUES ($1, 'relationship', 'test_seed') RETURNING id`,
        [userA.userId],
      );
      await superuserClient.query(
        `INSERT INTO relationships (id, user_id, relationship_class, subject_id, predicate, object_id) VALUES ($1, $2, 'social', $3, 'friend_of', $4)`,
        [relationshipSpine.rows[0].id, userA.userId, entitySpine.rows[0].id, actionId],
      );

      const res = await request(app.getHttpServer())
        .post('/v1/privacy/account/delete')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ immediate: true })
        .expect(200);
      expect(res.body.status).toBe('deleted');

      for (const table of ['events', 'observations', 'baselines', 'core_objects', 'webauthn_credentials']) {
        const countA = await superuserClient.query(`SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1`, [userA.userId]);
        expect(countA.rows[0].n).toBe(0);
      }
      // sessions rows are revoked, not deleted (docs/07 §7 step 2 — only
      // webauthn_credentials rows are actually removed).
      const activeSessionsA = await superuserClient.query(
        `SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`,
        [userA.userId],
      );
      expect(activeSessionsA.rows[0].n).toBe(0);

      const anonymized = await superuserClient.query(
        `SELECT apple_sub, email, display_name, status, deleted_at FROM users WHERE id = $1`,
        [userA.userId],
      );
      expect(anonymized.rows[0].apple_sub).toBe(`deleted-${userA.userId}`);
      expect(anonymized.rows[0].email).toBeNull();
      expect(anonymized.rows[0].display_name).toBeNull();
      expect(anonymized.rows[0].status).toBe('deleted');
      expect(anonymized.rows[0].deleted_at).not.toBeNull();

      // permission_grants/consent_records/audit_log survive, per the
      // retention table (docs/07 §5) — never deleted.
      const grants = await superuserClient.query(`SELECT count(*)::int AS n FROM permission_grants WHERE user_id = $1`, [userA.userId]);
      expect(grants.rows[0].n).toBeGreaterThan(0);
      const auditRows = await superuserClient.query(`SELECT count(*)::int AS n FROM audit_log WHERE acting_as_user_id = $1`, [userA.userId]);
      expect(auditRows.rows[0].n).toBeGreaterThan(0);

      // The same RLS cross-tenant proof Milestone 1 established: User B's
      // own data is completely untouched by User A's deletion.
      const userBEvents = await superuserClient.query(`SELECT count(*)::int AS n FROM events WHERE user_id = $1`, [userB.userId]);
      expect(userBEvents.rows[0].n).toBe(1);
      const userBStatus = await superuserClient.query(`SELECT status FROM users WHERE id = $1`, [userB.userId]);
      expect(userBStatus.rows[0].status).toBe('active');
    });
  });
});
