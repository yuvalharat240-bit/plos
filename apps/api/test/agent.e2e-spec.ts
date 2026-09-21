/**
 * Milestone 5 (docs/09-phase1-implementation-plan.md) verification, its
 * exact stated bar: ask "should I train tonight?" against seeded data (the
 * worked example in docs/03-system-architecture.md §4) — confirm real
 * sequential dispatch of the Fitness and Health pairs, confirm
 * disagreement between them surfaces rather than getting silently
 * resolved, and confirm a full Tier 2 confirm→execute→audit round trip
 * for cancelling a workout.
 *
 * `MODEL_PROVIDER` is overridden with `FakeModelProviderService` — the one
 * genuinely external, paid, non-deterministic dependency in this
 * milestone (a live Anthropic call) is faked; everything else (real
 * embedded Postgres, real RLS, real tool-executor chain, real
 * confirmation-token single-use enforcement, real audit logging, real
 * HTTP through the full guard pipeline) runs for real. Same harness shape
 * as test/sync.e2e-spec.ts.
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet, KeyLike } from 'jose';
import { AppModule } from '../src/app.module';
import { APPLE_JWKS_RESOLVER, APPLE_ISSUER } from '../src/auth/apple-identity.service';
import { MODEL_PROVIDER } from '../src/agent/model-provider/model-provider.interface';
import { FakeModelProviderService } from '../src/agent/model-provider/fake-model-provider.service';
import { bootstrapTestPostgres, teardownTestPostgres, testSuperuserUrl, TEST_DB_NAME } from './support/postgres-test-harness';

const PORT = 55437; // distinct from the other four suites' 55433-55436
const APP_ROLE_PASSWORD = 'plos_app_dev_only';

describe('Milestone 5: Agent orchestration (real HTTP, real Postgres, faked model)', () => {
  let pg: InstanceType<typeof import('embedded-postgres').default>;
  let superuserClient: Client;
  let app: INestApplication;
  let dataDir: string;
  let accessToken: string;
  let userId: string;
  let fakeModel: FakeModelProviderService;
  let plannedSessionId: string;
  let privateKey: KeyLike;

  const appUrl = `postgres://plos_app:${APP_ROLE_PASSWORD}@localhost:${PORT}/${TEST_DB_NAME}`;

  beforeAll(async () => {
    process.env.PLOS_AGENT_ASK_RATE_LIMIT = '3';
    process.env.PLOS_AGENT_ASK_RATE_TTL_MS = '60000';

    ({ pg, dataDir } = await bootstrapTestPostgres(PORT));

    superuserClient = new Client({ connectionString: testSuperuserUrl(PORT) });
    await superuserClient.connect();

    process.env.DATABASE_URL = appUrl;

    const { publicKey, privateKey: signingKey } = await generateKeyPair('RS256');
    privateKey = signingKey;
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'test-key-1';
    jwk.alg = 'RS256';
    const localJwks = createLocalJWKSet({ keys: [jwk] });

    fakeModel = new FakeModelProviderService();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APPLE_JWKS_RESOLVER)
      .useValue(localJwks)
      .overrideProvider(MODEL_PROVIDER)
      .useValue(fakeModel)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();

    const idToken = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setIssuer(APPLE_ISSUER)
      .setAudience('com.plos.app.not-yet-configured')
      .setSubject('apple-sub-milestone5')
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);
    const signIn = await request(app.getHttpServer())
      .post('/v1/auth/apple')
      .send({ identityToken: idToken })
      .expect(200);
    accessToken = signIn.body.accessToken;
    userId = signIn.body.userId;

    // Seed the exact three signals docs/03 §4's worked example depends on:
    // a below-baseline sleep classification, an on-schedule-looking
    // training-load baseline, and one planned tonight session to weigh
    // cancelling.
    await superuserClient.query(
      `INSERT INTO baselines (user_id, domain, metric, window_days, mean, stddev, current_value, deviation_z, classification, source)
       VALUES ($1, 'health', 'sleep_duration_min', 14, 445, 25, 342, -4.1, 'deteriorating', 'context_engine_worker')`,
      [userId],
    );
    await superuserClient.query(
      `INSERT INTO baselines (user_id, domain, metric, window_days, mean, stddev, current_value, deviation_z, classification, source)
       VALUES ($1, 'fitness', 'training_load', 14, 60, 10, 65, 0.5, 'normal', 'context_engine_worker')`,
      [userId],
    );

    plannedSessionId = randomUUID();
    await superuserClient.query(
      `INSERT INTO core_objects (id, user_id, object_type, source, is_user_entered) VALUES ($1, $2, 'event', 'user_entry', true)`,
      [plannedSessionId, userId],
    );
    await superuserClient.query(
      `INSERT INTO events (id, user_id, domain, event_type, starts_at, status) VALUES ($1, $2, 'fitness', 'workout', now() + interval '4 hours', 'planned')`,
      [plannedSessionId, userId],
    );
    await superuserClient.query(
      `INSERT INTO event_fitness_session (event_id, sport_type, training_load) VALUES ($1, 'run', 80)`,
      [plannedSessionId],
    );
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await superuserClient?.end();
    await teardownTestPostgres(pg, dataDir);
  });

  function scriptWorkedExample() {
    fakeModel.queueClassifyIntent({ domains: ['health', 'fitness'], modelVersion: 'fake-model-v1' });

    fakeModel.queueSpecialistRun('health_analysis', {
      toolCalls: [{ name: 'get_sleep_baseline_deviation', input: { windowDays: 14 } }],
      finding: {
        finding: 'Sleep was significantly below the 30-day baseline last night.',
        evidence: [{ coreObjectId: randomUUID(), description: 'sleep_duration_min baseline row, z=-4.1' }],
        confidence: 0.85,
        uncertainty: [],
        recommendation: null,
        requiresHumanReview: false,
        requiresUserConfirmation: false,
        riskTier: 0,
        dataTimestamp: new Date().toISOString(),
      },
    });
    fakeModel.queueSpecialistRun('health_safety', {
      toolCalls: [{ name: 'get_health_profile_summary', input: {} }],
      finding: {
        finding: 'No active symptoms or contraindications found; the sleep deficit itself is the relevant signal.',
        evidence: [],
        confidence: 0.8,
        uncertainty: [],
        recommendation: null,
        requiresHumanReview: false,
        requiresUserConfirmation: false,
        riskTier: 0,
        dataTimestamp: new Date().toISOString(),
        disagreesWithPrimary: { disagrees: false },
      },
    });

    fakeModel.queueSpecialistRun('fitness_performance', {
      toolCalls: [
        { name: 'get_training_load_baseline', input: {} },
        { name: 'get_recent_training_summary', input: { count: 5 } },
      ],
      finding: {
        finding: 'Training load is on schedule; taken alone, tonight looks like a normal planned session.',
        evidence: [{ coreObjectId: plannedSessionId, description: 'tonight\'s planned run, training_load=80' }],
        confidence: 0.7,
        uncertainty: [],
        recommendation: 'Train as planned tonight.',
        requiresHumanReview: false,
        requiresUserConfirmation: false,
        riskTier: 0,
        dataTimestamp: new Date().toISOString(),
        actionableSessionId: plannedSessionId,
      },
    });
    fakeModel.queueSpecialistRun('training_safety', {
      toolCalls: [{ name: 'get_active_injury_flags', input: {} }],
      finding: {
        finding: 'Given last night\'s significant sleep deficit, fatigue risk for tonight\'s planned high-load session is elevated.',
        evidence: [{ coreObjectId: plannedSessionId, description: 'planned session training_load=80 vs sleep deficit' }],
        confidence: 0.75,
        uncertainty: ['limited history for this exact sleep/training combination'],
        recommendation: 'Consider a lighter session or moving tonight\'s session to tomorrow.',
        requiresHumanReview: false,
        requiresUserConfirmation: true,
        riskTier: 2,
        dataTimestamp: new Date().toISOString(),
        disagreesWithPrimary: {
          disagrees: true,
          note: 'Fitness Performance reads training load alone as on-schedule; Training Safety weighs the sleep deficit and recommends a lighter session instead.',
        },
      },
    });

    fakeModel.queueSpecialistRun('life_master_agent', {
      finding: {
        finding:
          'Your sleep was significantly below your baseline last night. Training load alone looks on-schedule, but that carries elevated fatigue risk tonight.',
        evidence: [
          { coreObjectId: randomUUID(), description: 'sleep_duration_min baseline row, z=-4.1' },
          { coreObjectId: plannedSessionId, description: "tonight's planned run, training_load=80" },
        ],
        confidence: 0.7,
        uncertainty: [],
        recommendation: "Consider a lighter session or moving tonight's session to tomorrow.",
        requiresHumanReview: false,
        requiresUserConfirmation: true,
        riskTier: 2,
        dataTimestamp: new Date().toISOString(),
      },
    });
  }

  it('dispatches Health and Fitness pairs sequentially, surfaces the pair disagreement, and returns a pending confirmation for the planned session', async () => {
    scriptWorkedExample();

    const res = await request(app.getHttpServer())
      .post('/v1/agent/ask')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ question: 'Should I train tonight?' })
      .expect(200);

    expect(res.body.output.recommendation).toMatch(/lighter session|tomorrow/i);
    expect(res.body.output.riskTier).toBe(2);
    expect(res.body.output.requiresUserConfirmation).toBe(true);
    expect(res.body.pendingConfirmation).toEqual({ tool: 'cancel_scheduled_workout', sessionId: plannedSessionId });
    expect(res.body.omittedDomains).toEqual([]);

    // Pre-Milestone-8 audit finding, 2026-09-21: the composed answer's own
    // epistemic tag, and each evidence item's real tag resolved from its
    // core_objects row rather than left untagged on the wire. The
    // plannedSessionId row is a real scheduled event (epistemic_status
    // defaults to 'fact'); the sleep-baseline citation was never inserted
    // into core_objects in this test, so it correctly falls back to
    // 'ai_inference' rather than silently claiming 'fact'.
    expect(res.body.output.epistemicStatus).toBe('recommendation');
    expect(res.body.output.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ coreObjectId: plannedSessionId, epistemicStatus: 'fact' }),
        expect.objectContaining({ epistemicStatus: 'ai_inference' }),
      ]),
    );

    // Same finding: cross-domain disagreement (mechanism 3) must be a
    // structured field on the response, not only trusted to the
    // composition model's prose. Nothing was queued for the fake model's
    // detectDisagreement here (checkPair consumed the self-declared
    // verdicts for both pairs), so cross-domain correctly finds none.
    expect(res.body.crossDomainDisagreements).toEqual([]);

    // The disagreement is a real, persisted fact — not just something the
    // composed prose happens to mention.
    const disagreement = await superuserClient.query(
      `SELECT ao.disagrees_with_output_id, primary_ao.agent_name AS primary_agent_name
       FROM agent_outputs ao JOIN agent_outputs primary_ao ON primary_ao.id = ao.disagrees_with_output_id
       WHERE ao.user_id = $1 AND ao.agent_name = 'training_safety'`,
      [userId],
    );
    expect(disagreement.rows).toHaveLength(1);
    expect(disagreement.rows[0].primary_agent_name).toBe('fitness_performance');

    // Health pair agreed — no disagreement pointer.
    const healthSafety = await superuserClient.query(
      `SELECT disagrees_with_output_id FROM agent_outputs WHERE user_id = $1 AND agent_name = 'health_safety'`,
      [userId],
    );
    expect(healthSafety.rows[0].disagrees_with_output_id).toBeNull();

    // Sequential dispatch, not parallel: exactly 5 specialist outputs (2
    // health + 2 fitness) plus the 1 composed life_master_agent output.
    const outputCount = await superuserClient.query(
      `SELECT count(*)::int AS n FROM agent_outputs WHERE user_id = $1`,
      [userId],
    );
    expect(outputCount.rows[0].n).toBe(5);

    // A real conversation/turn trail exists (docs/08 §4.1).
    const turns = await superuserClient.query(
      `SELECT role FROM agent_turns t JOIN agent_conversations c ON c.id = t.conversation_id WHERE c.user_id = $1 ORDER BY t.created_at`,
      [userId],
    );
    expect(turns.rows.map((r) => r.role)).toEqual(['user', 'assistant']);

    // Real tool calls were actually audited, not skipped.
    const toolAudits = await superuserClient.query(
      `SELECT action, result, risk_tier FROM audit_log WHERE acting_as_user_id = $1 AND action LIKE 'tool.%'`,
      [userId],
    );
    expect(toolAudits.rows.some((r) => r.action === 'tool.get_sleep_baseline_deviation' && r.result === 'success')).toBe(true);
    expect(toolAudits.rows.some((r) => r.action === 'tool.get_training_load_baseline' && r.result === 'success')).toBe(true);
  });

  it("completes a full Tier 2 confirm→execute→audit round trip for cancelling the planned workout, and rejects a replayed token", async () => {
    const requested = await request(app.getHttpServer())
      .post('/v1/agent/actions/cancel-workout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ sessionId: plannedSessionId })
      .expect(200);
    expect(requested.body.status).toBe('confirmation_required');
    const { confirmationToken } = requested.body;
    expect(typeof confirmationToken).toBe('string');

    // Not yet executed — confirmation_required must not itself cancel.
    const beforeConfirm = await superuserClient.query(`SELECT status FROM events WHERE id = $1`, [plannedSessionId]);
    expect(beforeConfirm.rows[0].status).toBe('planned');

    const confirmed = await request(app.getHttpServer())
      .post('/v1/agent/actions/cancel-workout/confirm')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ sessionId: plannedSessionId, confirmationToken })
      .expect(200);
    expect(confirmed.body).toEqual({ status: 'executed', cancelled: true });

    const afterConfirm = await superuserClient.query(`SELECT status FROM events WHERE id = $1`, [plannedSessionId]);
    expect(afterConfirm.rows[0].status).toBe('cancelled');

    const action = await superuserClient.query(
      `SELECT action_type, executed_by, risk_tier, status FROM actions WHERE user_id = $1 AND action_type = 'workout_cancellation'`,
      [userId],
    );
    expect(action.rows[0]).toMatchObject({ action_type: 'workout_cancellation', executed_by: 'agent_on_behalf_of_user', risk_tier: 2, status: 'completed' });

    const auditRow = await superuserClient.query(
      `SELECT result FROM audit_log WHERE acting_as_user_id = $1 AND action = 'tool.cancel_scheduled_workout' ORDER BY occurred_at DESC LIMIT 1`,
      [userId],
    );
    expect(auditRow.rows[0].result).toBe('success');

    // Replay: the same token must not work a second time.
    const replay = await request(app.getHttpServer())
      .post('/v1/agent/actions/cancel-workout/confirm')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ sessionId: plannedSessionId, confirmationToken })
      .expect(403);
    expect(replay.status).toBe(403);
  });

  it('rejects an ask with an unrecognized/empty question (400)', async () => {
    await request(app.getHttpServer())
      .post('/v1/agent/ask')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ question: '' })
      .expect(400);
  });

  it('enforces the per-user rate limit on /v1/agent/ask (T9 must-fix)', async () => {
    // A fresh user/session — this suite's earlier tests already spent
    // part of `accessToken`'s own throttle bucket (the guard runs before
    // ValidationPipe, so even the rejected-400 ask above still counted).
    // The throttle tracks by userId (AgentAskThrottlerGuard), so a
    // distinct user starts with an empty bucket regardless of what the
    // shared user did earlier in this file. Reuses the same signing key
    // already registered with the overridden APPLE_JWKS_RESOLVER.
    const idToken2 = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setIssuer(APPLE_ISSUER)
      .setAudience('com.plos.app.not-yet-configured')
      .setSubject('apple-sub-milestone5-throttle')
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);
    const signIn2 = await request(app.getHttpServer())
      .post('/v1/auth/apple')
      .send({ identityToken: idToken2 })
      .expect(200);
    const accessToken2: string = signIn2.body.accessToken;

    // The suite's own throttle window is configured to limit=3/ttl=60s
    // (see beforeAll) specifically so this test doesn't need dozens of
    // scripted specialist runs to prove the limit is real.
    for (let i = 0; i < 3; i++) {
      fakeModel.queueClassifyIntent({ domains: [], modelVersion: 'fake-model-v1' });
      fakeModel.queueSpecialistRun('life_master_agent', {
        finding: {
          finding: 'Not enough was asked to dispatch a specialist.',
          evidence: [],
          confidence: 0.5,
          uncertainty: [],
          recommendation: null,
          requiresHumanReview: false,
          requiresUserConfirmation: false,
          riskTier: 0,
          dataTimestamp: new Date().toISOString(),
        },
      });
      await request(app.getHttpServer())
        .post('/v1/agent/ask')
        .set('Authorization', `Bearer ${accessToken2}`)
        .send({ question: `filler question ${i}` })
        .expect(200);
    }

    await request(app.getHttpServer())
      .post('/v1/agent/ask')
      .set('Authorization', `Bearer ${accessToken2}`)
      .send({ question: 'one too many' })
      .expect(429);
  });
});
