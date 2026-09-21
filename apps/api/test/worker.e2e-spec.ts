/**
 * Milestone 4 (docs/09-phase1-implementation-plan.md) verification, its
 * exact stated bar: "seed a week of observations for a test user, run
 * the job, confirm a `baselines` row with a sane classification... Then
 * a second test user in the same job run, confirming no cross-user
 * leakage through the connection pool — this is the concrete proof for
 * that specific T9 sub-item." Both are tested here directly, against a
 * real embedded Postgres (no mocking `TenantDatabaseService` — the whole
 * point is proving the real `runAsUser`-per-user discipline holds).
 *
 * No HTTP/supertest needed — `BaselineService` has no controller, so
 * this instantiates it directly (same pattern `rls.e2e-spec.ts` uses for
 * `TenantDatabaseService` itself, not going through NestJS DI/HTTP).
 *
 * Milestone 7: connects as `plos_worker`, not `plos_app` — every prior
 * "ran the real worker" verification in this project (including this
 * file, before this change) actually used `plos_app` credentials, which
 * is exactly the gap `028_least_privilege_worker_role.js` found and
 * fixed. Running the real worker code path against the tightened
 * `plos_worker` grants here is what actually proves those grants are
 * sufficient, not just written and assumed.
 */
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { runner } from 'node-pg-migrate';
import { TenantDatabaseService } from '../src/database/tenant-database.service';
import { BaselineService } from '../src/worker/baseline.service';
import { CalendarDensityService } from '../src/worker/calendar-density.service';
import { WINDOW_DAYS } from '../src/worker/metric-definitions';

const PORT = 55436; // distinct from the other three suites' 55433-55435
const DB_NAME = 'plos_test';
const SUPERUSER = 'postgres';
const SUPERUSER_PASSWORD = 'postgres_test_only';
const WORKER_ROLE_PASSWORD = 'plos_worker_dev_only';

describe('Milestone 4: Personal Baseline Engine / worker (real Postgres)', () => {
  let pg: InstanceType<typeof import('embedded-postgres').default>;
  let superuserClient: Client;
  let db: TenantDatabaseService;
  let baselineService: BaselineService;
  let calendarDensityService: CalendarDensityService;
  let dataDir: string;

  const superuserUrl = `postgres://${SUPERUSER}:${SUPERUSER_PASSWORD}@localhost:${PORT}/${DB_NAME}`;
  const workerUrl = `postgres://plos_worker:${WORKER_ROLE_PASSWORD}@localhost:${PORT}/${DB_NAME}`;

  let userA: string;
  let userB: string;

  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

  /** Seeds one core_objects + observations + extension row, as the superuser (bypasses RLS — this is fixture setup, not the thing under test). */
  async function seedObservation(
    userId: string,
    domain: string,
    observationType: string,
    observedAt: string,
    extensionTable: string,
    extensionColumns: Record<string, unknown>,
  ) {
    const id = randomUUID();
    await superuserClient.query(
      `INSERT INTO core_objects (id, user_id, object_type, source) VALUES ($1, $2, 'observation', 'test_seed')`,
      [id, userId],
    );
    await superuserClient.query(
      `INSERT INTO observations (id, user_id, domain, observation_type, observed_at) VALUES ($1, $2, $3, $4, $5)`,
      [id, userId, domain, observationType, observedAt],
    );
    const cols = Object.keys(extensionColumns);
    const placeholders = cols.map((_, i) => `$${i + 2}`).join(', ');
    await superuserClient.query(
      `INSERT INTO ${extensionTable} (observation_id, ${cols.join(', ')}) VALUES ($1, ${placeholders})`,
      [id, ...cols.map((c) => extensionColumns[c])],
    );
  }

  beforeAll(async () => {
    const dynamicImport = new Function(
      'specifier',
      'return import(specifier)',
    ) as (specifier: string) => Promise<{ default: typeof import('embedded-postgres').default }>;
    const { default: EmbeddedPostgres } = await dynamicImport('embedded-postgres');
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plos-pg-m4-'));

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

    process.env.DATABASE_URL = workerUrl;
    db = new TenantDatabaseService();
    baselineService = new BaselineService(db);
    calendarDensityService = new CalendarDensityService(db);

    userA = randomUUID();
    userB = randomUUID();
    await superuserClient.query(
      `INSERT INTO users (id, apple_sub, display_name) VALUES ($1, $2, 'User A'), ($3, $4, 'User B')`,
      [userA, `apple-sub-a-${userA}`, userB, `apple-sub-b-${userB}`],
    );

    // User A: sleep (tight cluster, stays "normal"), training_load (only
    // 2 points — below MIN_SAMPLES, proves the "don't fabricate" gate),
    // mood_score (4 baseline + 1 clear spike — drives new_pattern →
    // improving → repeated_pattern across three runs), stress_score
    // (3 identical values — exercises the zero-stddev branch).
    for (const [days, value] of [[10, 420], [7, 421], [4, 419], [1, 420]] as [number, number][]) {
      await seedObservation(userA, 'health', 'sleep', daysAgo(days), 'observation_sleep', {
        sleep_start: daysAgo(days),
        sleep_end: daysAgo(days),
        duration_min: value,
      });
    }
    const loadEventA1 = randomUUID();
    const loadEventA2 = randomUUID();
    for (const [id, days, load] of [[loadEventA1, 5, 50], [loadEventA2, 2, 60]] as [string, number, number][]) {
      await superuserClient.query(
        `INSERT INTO core_objects (id, user_id, object_type, source) VALUES ($1, $2, 'event', 'test_seed')`,
        [id, userA],
      );
      await superuserClient.query(
        `INSERT INTO events (id, user_id, domain, event_type, starts_at) VALUES ($1, $2, 'fitness', 'workout', $3)`,
        [id, userA, daysAgo(days)],
      );
      await superuserClient.query(
        `INSERT INTO event_fitness_session (event_id, sport_type, training_load) VALUES ($1, 'run', $2)`,
        [id, load],
      );
    }
    for (const [days, value] of [[8, 5], [6, 5], [4, 5], [2, 5], [0, 8]] as [number, number][]) {
      await seedObservation(userA, 'mental_health', 'journal_entry', daysAgo(days), 'observation_journal_entry', {
        entry_kind: 'structured_checkin',
        mood_score: value,
      });
    }
    for (const [days, value] of [[6, 3], [3, 3], [1, 3]] as [number, number][]) {
      await seedObservation(userA, 'mental_health', 'journal_entry', daysAgo(days), 'observation_journal_entry', {
        entry_kind: 'structured_checkin',
        stress_score: value,
      });
    }

    // User B: sleep only, deliberately a completely different range from
    // User A's — this is the cross-tenant leakage tripwire.
    for (const [days, value] of [[9, 280], [6, 290], [3, 300], [1, 310]] as [number, number][]) {
      await seedObservation(userB, 'health', 'sleep', daysAgo(days), 'observation_sleep', {
        sleep_start: daysAgo(days),
        sleep_end: daysAgo(days),
        duration_min: value,
      });
    }

    // User A: 3 calendar events tomorrow (>= the busy threshold) for
    // CalendarDensityService; User B gets none, the same cross-tenant
    // tripwire shape as the sleep data above. Timestamps are computed IN
    // SQL, relative to the same `date_trunc('day', now())` boundary
    // CalendarDensityService's own query uses — computing "tomorrow" in
    // JS and passing a fixed ISO string was flaky (a real bug, found by
    // this test failing intermittently): the server's `now()` runs in
    // its own TimeZone (not UTC), so a JS-side midnight boundary and the
    // server's own `date_trunc('day', now())` don't necessarily agree,
    // and "+30 hours from now" can land in the wrong calendar day
    // entirely depending on what time of day the suite happens to run.
    for (const hoursIntoTomorrow of [10, 14, 18]) {
      const id = randomUUID();
      await superuserClient.query(
        `INSERT INTO core_objects (id, user_id, object_type, source) VALUES ($1, $2, 'event', 'test_seed')`,
        [id, userA],
      );
      await superuserClient.query(
        `INSERT INTO events (id, user_id, domain, event_type, starts_at)
         VALUES ($1, $2, 'productivity', 'calendar_item', date_trunc('day', now()) + interval '1 day' + ($3 || ' hours')::interval)`,
        [id, userA, hoursIntoTomorrow],
      );
      await superuserClient.query(
        `INSERT INTO event_calendar_item (event_id, calendar_provider, external_event_id) VALUES ($1, 'apple_calendar', $2)`,
        [id, `cal-${id}`],
      );
    }
  }, 120_000);

  afterAll(async () => {
    await superuserClient?.end();
    await db?.onModuleDestroy();
    await pg?.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('computes real mean/stddev/current_value/classification for a well-populated metric', async () => {
    const result = await baselineService.computeForUser(userA);
    expect(result.written).toBe(3); // sleep, mood, stress — training_load has too few points
    expect(result.skipped).toBe(1);

    const mood = await superuserClient.query(
      `SELECT mean, stddev, current_value, deviation_z, classification, window_days
       FROM baselines WHERE user_id = $1 AND domain = 'mental_health' AND metric = 'mood_score'`,
      [userA],
    );
    expect(mood.rows).toHaveLength(1);
    expect(Number(mood.rows[0].mean)).toBeCloseTo(5.6, 1);
    expect(Number(mood.rows[0].current_value)).toBe(8);
    expect(Number(mood.rows[0].deviation_z)).toBeCloseTo(1.789, 1);
    expect(mood.rows[0].window_days).toBe(WINDOW_DAYS);
    // First-ever computation for this (user, domain, metric, window) — new_pattern regardless of z.
    expect(mood.rows[0].classification).toBe('new_pattern');
  });

  it('does not fabricate a baseline when a metric has fewer than MIN_SAMPLES data points', async () => {
    const row = await superuserClient.query(
      `SELECT 1 FROM baselines WHERE user_id = $1 AND domain = 'fitness' AND metric = 'training_load'`,
      [userA],
    );
    expect(row.rows).toHaveLength(0);
  });

  it('handles a zero-stddev window (identical samples) without dividing by zero', async () => {
    const stress = await superuserClient.query(
      `SELECT stddev, deviation_z, classification FROM baselines WHERE user_id = $1 AND metric = 'stress_score'`,
      [userA],
    );
    expect(Number(stress.rows[0].stddev)).toBe(0);
    expect(Number(stress.rows[0].deviation_z)).toBe(0);
    expect(stress.rows[0].classification).toBe('new_pattern');
  });

  it('evolves classification across repeated runs: new_pattern → a real signal → repeated_pattern', async () => {
    const second = await baselineService.computeForUser(userA);
    expect(second.written).toBe(3);
    const afterSecond = await superuserClient.query(
      `SELECT classification FROM baselines WHERE user_id = $1 AND metric = 'mood_score'`,
      [userA],
    );
    expect(afterSecond.rows[0].classification).toBe('improving'); // higherIsBetter, z > 0, moderate magnitude

    const third = await baselineService.computeForUser(userA);
    expect(third.written).toBe(3);
    const afterThird = await superuserClient.query(
      `SELECT classification FROM baselines WHERE user_id = $1 AND metric = 'mood_score'`,
      [userA],
    );
    // Same underlying data → same signal two computations running → repeated_pattern.
    expect(afterThird.rows[0].classification).toBe('repeated_pattern');

    const sleepStaysNormal = await superuserClient.query(
      `SELECT classification FROM baselines WHERE user_id = $1 AND metric = 'sleep_duration_min'`,
      [userA],
    );
    // A tightly-clustered metric never leaves 'normal', and 'normal' never becomes 'repeated_pattern' —
    // repeating unremarkably isn't itself a notable pattern.
    expect(sleepStaysNormal.rows[0].classification).toBe('normal');
  });

  it("T9's must-fix: a second user processed in the same job run shows zero cross-tenant leakage", async () => {
    const result = await baselineService.computeForUser(userB);
    expect(result.written).toBe(1); // only sleep was seeded for User B

    const bSleep = await superuserClient.query(
      `SELECT mean, current_value FROM baselines WHERE user_id = $1 AND metric = 'sleep_duration_min'`,
      [userB],
    );
    expect(Number(bSleep.rows[0].mean)).toBeCloseTo(295, 0); // avg(280,290,300,310)
    expect(Number(bSleep.rows[0].current_value)).toBe(310);

    // The concrete proof: User A's own row, recomputed multiple times
    // above while User B had zero rows, was never touched by User B's
    // very different values, and vice versa — no shared connection ever
    // carried one user's data into the other's transaction.
    const aSleep = await superuserClient.query(
      `SELECT mean FROM baselines WHERE user_id = $1 AND metric = 'sleep_duration_min'`,
      [userA],
    );
    expect(Number(aSleep.rows[0].mean)).toBeCloseTo(420, 0);
    expect(Number(aSleep.rows[0].mean)).not.toBeCloseTo(295, 0);

    const bRowCount = await superuserClient.query(`SELECT count(*)::int AS n FROM baselines WHERE user_id = $1`, [
      userB,
    ]);
    expect(bRowCount.rows[0].n).toBe(1); // never gained User A's mood/stress rows
  });

  it('CalendarDensityService (Milestone 5 gap fix): classifies a busy tomorrow as anomalous, with zero cross-tenant leakage', async () => {
    await calendarDensityService.computeForUser(userA);
    await calendarDensityService.computeForUser(userB);

    const a = await superuserClient.query(
      `SELECT current_value, classification, mean, stddev FROM baselines
       WHERE user_id = $1 AND domain = 'productivity' AND metric = 'calendar_density_next_day'`,
      [userA],
    );
    expect(Number(a.rows[0].current_value)).toBe(3);
    expect(a.rows[0].classification).toBe('anomalous');
    expect(a.rows[0].mean).toBeNull();
    expect(a.rows[0].stddev).toBeNull();

    const b = await superuserClient.query(
      `SELECT current_value, classification FROM baselines
       WHERE user_id = $1 AND domain = 'productivity' AND metric = 'calendar_density_next_day'`,
      [userB],
    );
    expect(Number(b.rows[0].current_value)).toBe(0);
    expect(b.rows[0].classification).toBe('normal');
  });
});
