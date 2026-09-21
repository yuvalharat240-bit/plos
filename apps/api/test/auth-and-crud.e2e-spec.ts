/**
 * Milestone 2 (docs/09-phase1-implementation-plan.md) verification: a
 * real NestJS application (the actual AppModule, not a hand-built test
 * harness) served over real HTTP via supertest, backed by a real
 * Postgres (embedded-postgres, same approach as rls.e2e-spec.ts — no
 * Docker/system Postgres in this environment). The only substitution is
 * Apple's JWKS: AppleIdentityService's real jwtVerify() code path runs
 * unchanged, verifying a token signed by a locally-generated RSA keypair
 * instead of fetching Apple's actual public keys over the network — this
 * is dependency injection, not a mock of the verification logic itself.
 * Passkey registration/login use a real virtual FIDO2 authenticator
 * (test/support/virtual-authenticator.ts) producing genuine CBOR/ECDSA
 * ceremony responses, so @simplewebauthn/server's verify functions run
 * their real cryptographic checks too.
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { runner } from 'node-pg-migrate';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import { AppModule } from '../src/app.module';
import { APPLE_JWKS_RESOLVER, APPLE_ISSUER } from '../src/auth/apple-identity.service';
import { VirtualAuthenticator } from './support/virtual-authenticator';

const PORT = 55434; // distinct from rls.e2e-spec.ts's 55433 in case both ever run concurrently
const DB_NAME = 'plos_test';
const SUPERUSER = 'postgres';
const SUPERUSER_PASSWORD = 'postgres_test_only';
const APP_ROLE_PASSWORD = 'plos_app_dev_only';

describe('Milestone 2: auth + CRUD (real HTTP, real Postgres)', () => {
  let pg: InstanceType<typeof import('embedded-postgres').default>;
  let superuserClient: Client;
  let app: INestApplication;
  let dataDir: string;
  let signAppleToken: (sub: string, email?: string) => Promise<string>;

  const superuserUrl = `postgres://${SUPERUSER}:${SUPERUSER_PASSWORD}@localhost:${PORT}/${DB_NAME}`;
  const appUrl = `postgres://plos_app:${APP_ROLE_PASSWORD}@localhost:${PORT}/${DB_NAME}`;

  beforeAll(async () => {
    const dynamicImport = new Function(
      'specifier',
      'return import(specifier)',
    ) as (specifier: string) => Promise<{ default: typeof import('embedded-postgres').default }>;
    const { default: EmbeddedPostgres } = await dynamicImport('embedded-postgres');
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plos-pg-m2-'));

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
        singleTransaction: false, // tolerate 022 (pgvector) failing — see that file's header
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
    process.env.WEBAUTHN_RP_ID = 'localhost';
    process.env.WEBAUTHN_ORIGIN = 'https://localhost';

    // Real RSA keypair standing in for Apple's — AppleIdentityService's
    // verification code is exercised for real against this JWKS.
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'test-key-1';
    jwk.alg = 'RS256';
    const localJwks = createLocalJWKSet({ keys: [jwk] });

    signAppleToken = (sub: string, email?: string) =>
      new SignJWT({ email })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
        .setIssuer(APPLE_ISSUER)
        .setAudience('com.plos.app.not-yet-configured') // AppleIdentityService's default APPLE_AUDIENCE
        .setSubject(sub)
        .setIssuedAt()
        .setExpirationTime('10m')
        .sign(privateKey);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APPLE_JWKS_RESOLVER)
      .useValue(localJwks)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await superuserClient?.end();
    await pg?.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  describe('Sign in with Apple + session lifecycle', () => {
    let accessToken: string;
    let refreshToken: string;
    let userId: string;

    it('creates a new user and issues tokens on first sign-in', async () => {
      const idToken = await signAppleToken('apple-sub-milestone2-a');
      const res = await request(app.getHttpServer())
        .post('/v1/auth/apple')
        .send({ identityToken: idToken })
        .expect(200);

      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.refreshToken).toEqual(expect.any(String));
      expect(res.body.userId).toEqual(expect.any(String));
      expect(res.body.isNew).toBe(true);
      accessToken = res.body.accessToken;
      refreshToken = res.body.refreshToken;
      userId = res.body.userId;

      const userRow = await superuserClient.query('SELECT apple_sub FROM users WHERE id = $1', [
        userId,
      ]);
      expect(userRow.rows[0].apple_sub).toBe('apple-sub-milestone2-a');
    });

    it('signs the same Apple sub back into the same user (no duplicate)', async () => {
      const idToken = await signAppleToken('apple-sub-milestone2-a');
      const res = await request(app.getHttpServer())
        .post('/v1/auth/apple')
        .send({ identityToken: idToken })
        .expect(200);
      expect(res.body.userId).toBe(userId);
      expect(res.body.isNew).toBe(false);

      const count = await superuserClient.query(
        'SELECT count(*)::int AS n FROM users WHERE apple_sub = $1',
        ['apple-sub-milestone2-a'],
      );
      expect(count.rows[0].n).toBe(1);
    });

    it('completes onboarding: sets display name and creates a primary goal', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ displayName: 'Dana', primaryGoal: 'Train consistently' })
        .expect(200);
      expect(res.body.id).toBe(userId);

      const userRow = await superuserClient.query('SELECT display_name FROM users WHERE id = $1', [
        userId,
      ]);
      expect(userRow.rows[0].display_name).toBe('Dana');

      const goalRow = await superuserClient.query(
        `SELECT domain, title, goal_type FROM goals WHERE user_id = $1`,
        [userId],
      );
      expect(goalRow.rows).toHaveLength(1);
      expect(goalRow.rows[0].domain).toBe('fitness');
      expect(goalRow.rows[0].title).toBe('Train consistently');
      expect(goalRow.rows[0].goal_type).toBe('outcome');
    });

    it('rejects an onboarding call with an unrecognized primaryGoal value', async () => {
      await request(app.getHttpServer())
        .patch('/v1/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ primaryGoal: 'Become a wizard' })
        .expect(400);
    });

    it('auto-grants every MVP self_app scope except professional.share on first signup', async () => {
      const scopes = await superuserClient.query(
        `SELECT scope FROM permission_grants WHERE user_id = $1 AND grantee_type = 'self_app' AND revoked_at IS NULL ORDER BY scope`,
        [userId],
      );
      const granted = scopes.rows.map((r) => r.scope);
      expect(granted).toContain('mental_health.write');
      expect(granted).toContain('fitness.write');
      expect(granted).toContain('health.write');
      expect(granted).not.toContain('professional.share');
    });

    it('rejects a protected route with no bearer token', async () => {
      await request(app.getHttpServer()).post('/v1/journal').send({ entryKind: 'free_text' }).expect(401);
    });

    it('rejects a protected route with a garbage bearer token', async () => {
      await request(app.getHttpServer())
        .post('/v1/journal')
        .set('Authorization', 'Bearer not-a-real-token')
        .send({ entryKind: 'free_text' })
        .expect(401);
    });

    it('creates a journal entry, workout, and medication log — each a real RLS-scoped row', async () => {
      const journalRes = await request(app.getHttpServer())
        .post('/v1/journal')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ entryKind: 'free_text', entryText: 'felt good today', moodScore: 8, tags: ['gratitude'] })
        .expect(201);
      const journalRow = await superuserClient.query(
        `SELECT o.user_id, j.entry_text, j.tags FROM observations o
         JOIN observation_journal_entry j ON j.observation_id = o.id
         WHERE o.id = $1`,
        [journalRes.body.id],
      );
      expect(journalRow.rows[0].user_id).toBe(userId);
      expect(journalRow.rows[0].entry_text).toBe('felt good today');
      expect(journalRow.rows[0].tags).toEqual(['gratitude']);

      const workoutRes = await request(app.getHttpServer())
        .post('/v1/workouts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          sportType: 'run',
          startsAt: new Date().toISOString(),
          durationMin: 30,
          sets: [{ exerciseName: 'tempo interval', setNumber: 1, reps: 1 }],
        })
        .expect(201);
      const workoutRow = await superuserClient.query(
        `SELECT e.user_id, f.sport_type, (SELECT count(*)::int FROM fitness_session_set WHERE event_id = e.id) AS set_count
         FROM events e JOIN event_fitness_session f ON f.event_id = e.id WHERE e.id = $1`,
        [workoutRes.body.id],
      );
      expect(workoutRow.rows[0].user_id).toBe(userId);
      expect(workoutRow.rows[0].sport_type).toBe('run');
      expect(workoutRow.rows[0].set_count).toBe(1);

      const medRes = await request(app.getHttpServer())
        .post('/v1/medications')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ medicationName: 'ibuprofen', dose: '200', unit: 'mg', takenAt: new Date().toISOString() })
        .expect(201);
      const medRow = await superuserClient.query(
        `SELECT a.user_id, a.executed_by, a.risk_tier, m.medication_name
         FROM actions a JOIN action_medication_log m ON m.action_id = a.id WHERE a.id = $1`,
        [medRes.body.id],
      );
      expect(medRow.rows[0].user_id).toBe(userId);
      expect(medRow.rows[0].executed_by).toBe('user');
      expect(medRow.rows[0].risk_tier).toBe(1);
      expect(medRow.rows[0].medication_name).toBe('ibuprofen');

      // The real gap Milestone 2 found and fixed (023_audit_log_write_policy.js):
      // without that policy, every one of the three inserts above's audit_log
      // write would have been silently blocked by RLS despite table GRANTs.
      const auditRows = await superuserClient.query(
        `SELECT action FROM audit_log WHERE acting_as_user_id = $1 AND action IN ('journal.create','workout.create','medication.log')`,
        [userId],
      );
      expect(auditRows.rows.map((r) => r.action).sort()).toEqual([
        'journal.create',
        'medication.log',
        'workout.create',
      ]);
    });

    it('rejects a CRUD write when the specific scope has been revoked (ScopeGuard is real, not decorative)', async () => {
      await superuserClient.query(
        `UPDATE permission_grants SET revoked_at = now() WHERE user_id = $1 AND scope = 'mental_health.write'`,
        [userId],
      );
      await request(app.getHttpServer())
        .post('/v1/journal')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ entryKind: 'free_text', entryText: 'should be blocked' })
        .expect(403);

      // Restore for later tests/assertions in this file.
      await superuserClient.query(
        `UPDATE permission_grants SET revoked_at = NULL WHERE user_id = $1 AND scope = 'mental_health.write'`,
        [userId],
      );
    });

    it('rotates the refresh token and invalidates the previous one', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/refresh')
        .send({ refreshToken })
        .expect(200);
      expect(res.body.userId).toBe(userId);
      const newAccessToken = res.body.accessToken;
      const newRefreshToken = res.body.refreshToken;
      expect(newRefreshToken).not.toBe(refreshToken);

      // The old refresh token is gone (rotated away) — reusing it must fail.
      await request(app.getHttpServer()).post('/v1/auth/refresh').send({ refreshToken }).expect(401);

      accessToken = newAccessToken;
      refreshToken = newRefreshToken;
    });

    it('logs out and revokes the session — the now-revoked access token is rejected by AuthGuard', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // Same access token, same 15-minute JWT validity window — only the
      // live sessions-row check (AuthGuard's DB read) can catch this.
      await request(app.getHttpServer())
        .post('/v1/journal')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ entryKind: 'free_text' })
        .expect(401);
    });
  });

  describe('Passkey registration + login (real WebAuthn ceremony, virtual authenticator)', () => {
    let accessToken: string;
    let userId: string;
    const authenticator = new VirtualAuthenticator();

    beforeAll(async () => {
      const idToken = await signAppleToken('apple-sub-milestone2-passkey');
      const res = await request(app.getHttpServer())
        .post('/v1/auth/apple')
        .send({ identityToken: idToken })
        .expect(200);
      accessToken = res.body.accessToken;
      userId = res.body.userId;
    });

    it('registers a new passkey for the authenticated user', async () => {
      const optionsRes = await request(app.getHttpServer())
        .post('/v1/auth/passkey/register/options')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      const { attemptId, options } = optionsRes.body;

      const credential = authenticator.register(
        options.rp.id,
        options.challenge,
        `https://${options.rp.id}`,
      );

      await request(app.getHttpServer())
        .post('/v1/auth/passkey/register/verify')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ attemptId, response: credential, deviceName: 'Test Virtual Authenticator' })
        .expect(200)
        .expect((res: request.Response) => expect(res.body.success).toBe(true));

      const stored = await superuserClient.query(
        `SELECT user_id, sign_count, device_name FROM webauthn_credentials WHERE user_id = $1`,
        [userId],
      );
      expect(stored.rows).toHaveLength(1);
      expect(stored.rows[0].device_name).toBe('Test Virtual Authenticator');
    });

    it('logs in with the registered passkey alone (no Apple token) and gets a real session', async () => {
      const optionsRes = await request(app.getHttpServer())
        .post('/v1/auth/passkey/login/options')
        .expect(200);
      const { attemptId, options } = optionsRes.body;

      const assertion = authenticator.authenticate(
        options.rpId ?? 'localhost',
        options.challenge,
        'https://localhost',
      );

      const verifyRes = await request(app.getHttpServer())
        .post('/v1/auth/passkey/login/verify')
        .send({ attemptId, response: assertion })
        .expect(200);

      expect(verifyRes.body.userId).toBe(userId);
      expect(verifyRes.body.accessToken).toEqual(expect.any(String));

      const counter = await superuserClient.query(
        `SELECT sign_count FROM webauthn_credentials WHERE user_id = $1`,
        [userId],
      );
      expect(Number(counter.rows[0].sign_count)).toBeGreaterThan(0);
    });

    it('rejects reusing the same passkey login attempt twice (challenge is single-use)', async () => {
      const optionsRes = await request(app.getHttpServer())
        .post('/v1/auth/passkey/login/options')
        .expect(200);
      const { attemptId, options } = optionsRes.body;
      const assertion = authenticator.authenticate(
        options.rpId ?? 'localhost',
        options.challenge,
        'https://localhost',
      );

      await request(app.getHttpServer())
        .post('/v1/auth/passkey/login/verify')
        .send({ attemptId, response: assertion })
        .expect(200);

      // Same attemptId again: already consumed.
      await request(app.getHttpServer())
        .post('/v1/auth/passkey/login/verify')
        .send({ attemptId, response: assertion })
        .expect(401);
    });

    it('rejects a cloned-authenticator replay reporting counter=0 against an already-nonzero stored counter (docs/09 Milestone 7 finding: the original check only skipped clone detection when BOTH values were zero for real; as written it dropped the check whenever the new counter alone was 0, regardless of what was already stored)', async () => {
      const before = await superuserClient.query(`SELECT sign_count FROM webauthn_credentials WHERE user_id = $1`, [userId]);
      expect(Number(before.rows[0].sign_count)).toBeGreaterThan(0);

      const optionsRes = await request(app.getHttpServer())
        .post('/v1/auth/passkey/login/options')
        .expect(200);
      const { attemptId, options } = optionsRes.body;

      // Force this one assertion's genuinely-signed counter to 0 —
      // simulating a cloned/reset authenticator, not a legitimate one
      // that has simply never incremented (this device's own stored
      // counter is already > 0, so it has a real history of advancing).
      authenticator.forceNextCounter(0);
      const assertion = authenticator.authenticate(options.rpId ?? 'localhost', options.challenge, 'https://localhost');

      // @simplewebauthn/server's own internal counter check throws first
      // (caught and converted to 401 in passkey.service.ts) — this
      // codebase's own application-level counter re-check in
      // auth.controller.ts is a second, independent statement of the
      // same invariant, exercised directly (not via HTTP, for the same
      // reason idor.e2e-spec.ts's own scope-denial test bypasses HTTP)
      // in the assertion right below.
      await request(app.getHttpServer())
        .post('/v1/auth/passkey/login/verify')
        .send({ attemptId, response: assertion })
        .expect(401);

      // Fail-closed, not fail-open-then-silently-fix: the stored counter
      // must be untouched by the rejected attempt.
      const after = await superuserClient.query(`SELECT sign_count FROM webauthn_credentials WHERE user_id = $1`, [userId]);
      expect(after.rows[0].sign_count).toEqual(before.rows[0].sign_count);
    });
  });
});
