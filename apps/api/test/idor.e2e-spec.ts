/**
 * Milestone 7 (docs/09-phase1-implementation-plan.md) verification: "an
 * IDOR test suite specifically targeting `cancel_scheduled_workout` (the
 * one Tier 2+ target that exists at MVP)." Real HTTP against real
 * embedded Postgres, same harness shape as every other suite — this one
 * exists specifically to attack docs/06-threat-model.md T3's must-fix
 * ("user_id taken only from RequestContext, never a tool argument;
 * ownership re-check on cancel_scheduled_workout"), not to re-prove
 * functionality Milestone 5's own suite already covers.
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { runner } from 'node-pg-migrate';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet, KeyLike } from 'jose';
import { AppModule } from '../src/app.module';
import { APPLE_JWKS_RESOLVER, APPLE_ISSUER } from '../src/auth/apple-identity.service';
import { ToolExecutorService } from '../src/agent/tools/tool-executor.service';
import { TenantDatabaseService } from '../src/database/tenant-database.service';

const PORT = 55439; // distinct from the other six suites' 55433-55438
const DB_NAME = 'plos_test';
const SUPERUSER = 'postgres';
const SUPERUSER_PASSWORD = 'postgres_test_only';
const APP_ROLE_PASSWORD = 'plos_app_dev_only';

describe('Milestone 7: IDOR suite for cancel_scheduled_workout (real HTTP, real Postgres)', () => {
  let pg: InstanceType<typeof import('embedded-postgres').default>;
  let superuserClient: Client;
  let app: INestApplication;
  let dataDir: string;
  let privateKey: KeyLike;

  const superuserUrl = `postgres://${SUPERUSER}:${SUPERUSER_PASSWORD}@localhost:${PORT}/${DB_NAME}`;
  const appUrl = `postgres://plos_app:${APP_ROLE_PASSWORD}@localhost:${PORT}/${DB_NAME}`;

  beforeAll(async () => {
    // This suite signs in ~10 distinct users — comfortably over the
    // production 'auth' throttler's default limit (10/min per IP) if left
    // unset, since every sign-in in one test file shares the same
    // supertest-local IP. Same "override before compiling the testing
    // module" pattern as agent.e2e-spec.ts's own rate-limit test.
    process.env.PLOS_AUTH_RATE_LIMIT = '1000';

    const dynamicImport = new Function(
      'specifier',
      'return import(specifier)',
    ) as (specifier: string) => Promise<{ default: typeof import('embedded-postgres').default }>;
    const { default: EmbeddedPostgres } = await dynamicImport('embedded-postgres');
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plos-pg-m7-idor-'));

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

  async function seedPlannedWorkout(userId: string): Promise<string> {
    const sessionId = randomUUID();
    await superuserClient.query(
      `INSERT INTO core_objects (id, user_id, object_type, source, is_user_entered) VALUES ($1, $2, 'event', 'user_entry', true)`,
      [sessionId, userId],
    );
    await superuserClient.query(
      `INSERT INTO events (id, user_id, domain, event_type, starts_at, status) VALUES ($1, $2, 'fitness', 'workout', now() + interval '4 hours', 'planned')`,
      [sessionId, userId],
    );
    await superuserClient.query(
      `INSERT INTO event_fitness_session (event_id, sport_type, training_load) VALUES ($1, 'run', 70)`,
      [sessionId],
    );
    return sessionId;
  }

  it("mints a confirmation token for another user's session id without touching anything (requiresConfirmation is checked before ownership, by design — docs/05 §6's chain runs Confirmation before Execution), but actually confirming it 404s and leaves the victim's session untouched", async () => {
    const attacker = await signIn('apple-sub-m7-idor-attacker-1');
    const victim = await signIn('apple-sub-m7-idor-victim-1');
    const victimSessionId = await seedPlannedWorkout(victim.userId);

    // The request step doesn't reveal ownership either way (a made-up
    // UUID gets the identical response) — no information leak, and
    // nothing in the database changes as a result of this call alone.
    const requested = await request(app.getHttpServer())
      .post('/v1/agent/actions/cancel-workout')
      .set('Authorization', `Bearer ${attacker.accessToken}`)
      .send({ sessionId: victimSessionId })
      .expect(200);
    expect(requested.body.status).toBe('confirmation_required');

    const statusAfterRequest = await superuserClient.query(`SELECT status FROM events WHERE id = $1`, [victimSessionId]);
    expect(statusAfterRequest.rows[0].status).toBe('planned');

    // The real enforcement point: redeeming that very token 404s, because
    // T3's must-fix — user_id from RequestContext only, ownership
    // re-checked inside execute() — holds regardless of how the token
    // was obtained.
    await request(app.getHttpServer())
      .post('/v1/agent/actions/cancel-workout/confirm')
      .set('Authorization', `Bearer ${attacker.accessToken}`)
      .send({ sessionId: victimSessionId, confirmationToken: requested.body.confirmationToken })
      .expect(404);

    const status = await superuserClient.query(`SELECT status FROM events WHERE id = $1`, [victimSessionId]);
    expect(status.rows[0].status).toBe('planned');
    const actions = await superuserClient.query(`SELECT count(*)::int AS n FROM actions WHERE user_id = $1`, [victim.userId]);
    expect(actions.rows[0].n).toBe(0);
  });

  it("rejects a forged confirmation attempt against another user's session with no prior confirmation_required step (a made-up token must fail signature verification, not silently no-op)", async () => {
    const attacker = await signIn('apple-sub-m7-idor-attacker-2');
    const victim = await signIn('apple-sub-m7-idor-victim-2');
    const victimSessionId = await seedPlannedWorkout(victim.userId);

    await request(app.getHttpServer())
      .post('/v1/agent/actions/cancel-workout/confirm')
      .set('Authorization', `Bearer ${attacker.accessToken}`)
      .send({ sessionId: victimSessionId, confirmationToken: 'not-a-real-token' })
      .expect(403);

    const status = await superuserClient.query(`SELECT status FROM events WHERE id = $1`, [victimSessionId]);
    expect(status.rows[0].status).toBe('planned');
  });

  it("a token minted for the attacker's OWN session cannot be replayed against a different sessionId (argsHash binding holds under a session-swap attempt)", async () => {
    const attacker = await signIn('apple-sub-m7-idor-attacker-3');
    const victim = await signIn('apple-sub-m7-idor-victim-3');
    const attackerOwnSessionId = await seedPlannedWorkout(attacker.userId);
    const victimSessionId = await seedPlannedWorkout(victim.userId);

    const requested = await request(app.getHttpServer())
      .post('/v1/agent/actions/cancel-workout')
      .set('Authorization', `Bearer ${attacker.accessToken}`)
      .send({ sessionId: attackerOwnSessionId })
      .expect(200);
    expect(requested.body.status).toBe('confirmation_required');
    const { confirmationToken } = requested.body;

    // Swap the sessionId in the confirm call, keeping the legitimately-
    // issued token — this is exactly what a token that only checked
    // {userId, toolName} and not the specific args would let through.
    await request(app.getHttpServer())
      .post('/v1/agent/actions/cancel-workout/confirm')
      .set('Authorization', `Bearer ${attacker.accessToken}`)
      .send({ sessionId: victimSessionId, confirmationToken })
      .expect(403);

    const victimStatus = await superuserClient.query(`SELECT status FROM events WHERE id = $1`, [victimSessionId]);
    expect(victimStatus.rows[0].status).toBe('planned');

    // The token is still valid for what it was actually minted for —
    // proves the rejection above was the args binding, not a broken/
    // already-consumed token.
    const confirmedOwn = await request(app.getHttpServer())
      .post('/v1/agent/actions/cancel-workout/confirm')
      .set('Authorization', `Bearer ${attacker.accessToken}`)
      .send({ sessionId: attackerOwnSessionId, confirmationToken })
      .expect(200);
    expect(confirmedOwn.body).toEqual({ status: 'executed', cancelled: true });
  });

  it("a stolen confirmation token cannot be redeemed under a different user's session/RLS context", async () => {
    const victim = await signIn('apple-sub-m7-idor-victim-4');
    const attacker = await signIn('apple-sub-m7-idor-attacker-4');
    const victimSessionId = await seedPlannedWorkout(victim.userId);

    // The victim legitimately starts a cancel — imagine the attacker
    // somehow intercepts this token (network log leak, shared device,
    // etc.) and tries to redeem it under their OWN authenticated session.
    const requested = await request(app.getHttpServer())
      .post('/v1/agent/actions/cancel-workout')
      .set('Authorization', `Bearer ${victim.accessToken}`)
      .send({ sessionId: victimSessionId })
      .expect(200);
    const { confirmationToken } = requested.body;

    await request(app.getHttpServer())
      .post('/v1/agent/actions/cancel-workout/confirm')
      .set('Authorization', `Bearer ${attacker.accessToken}`)
      .send({ sessionId: victimSessionId, confirmationToken })
      .expect(403);

    const status = await superuserClient.query(`SELECT status FROM events WHERE id = $1`, [victimSessionId]);
    expect(status.rows[0].status).toBe('planned');
  });

  it('sanity check: the legitimate owner can still cancel their own planned session (the control case every rejection above is measured against)', async () => {
    const owner = await signIn('apple-sub-m7-idor-owner');
    const sessionId = await seedPlannedWorkout(owner.userId);

    const requested = await request(app.getHttpServer())
      .post('/v1/agent/actions/cancel-workout')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ sessionId })
      .expect(200);
    const confirmed = await request(app.getHttpServer())
      .post('/v1/agent/actions/cancel-workout/confirm')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ sessionId, confirmationToken: requested.body.confirmationToken })
      .expect(200);
    expect(confirmed.body).toEqual({ status: 'executed', cancelled: true });
  });

  it('a scope-denial reached with no try/catch around it still writes its audit row (docs/09 Milestone 7 finding: ToolExecutorService used to throw on denial, which propagated into TenantDatabaseService.runAsUser\'s catch and rolled back the very audit row the chain had just written)', async () => {
    // Exercised directly against the real, fully-wired ToolExecutorService
    // rather than through HTTP: every *route* that reaches this tool
    // already requires the same scope the tool itself requires (defense
    // in depth, not two independent gates), so a route-level ScopeGuard
    // rejection would mask the tool-level one before it ever ran — this
    // is the one way to actually exercise ToolExecutorService's own
    // scope-denial branch in isolation, the same "instantiate the real
    // service directly, no HTTP" pattern test/worker.e2e-spec.ts uses.
    const user = await signIn('apple-sub-m7-idor-audit-survives');
    const sessionId = await seedPlannedWorkout(user.userId);

    const toolExecutor = app.get(ToolExecutorService);
    const db = app.get(TenantDatabaseService);

    const outcome = await db.runAsUser(user.userId, (client) =>
      toolExecutor.invoke({
        agentName: 'fitness_performance',
        toolName: 'cancel_scheduled_workout',
        rawArgs: { sessionId },
        userId: user.userId,
        scopes: [], // deliberately missing fitness.write
        client,
      }),
    );
    expect(outcome.status).toBe('denied');

    const audit = await superuserClient.query(
      `SELECT result, metadata FROM audit_log
       WHERE acting_as_user_id = $1 AND action = 'tool.cancel_scheduled_workout'
       ORDER BY occurred_at DESC LIMIT 1`,
      [user.userId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].result).toBe('denied');
    expect(audit.rows[0].metadata.reason).toBe('missing required scope');

    // The session itself was never touched — a denial, not a partial write.
    const status = await superuserClient.query(`SELECT status FROM events WHERE id = $1`, [sessionId]);
    expect(status.rows[0].status).toBe('planned');
  });
});
