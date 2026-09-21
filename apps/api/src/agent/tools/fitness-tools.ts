import { ScopedToolContract } from '../contracts/scoped-tool';
import { validateBoundedNumber } from './tools-validation';

/**
 * docs/05-agent-architecture.md §3.4, narrowed to docs/08-mvp-definition.md
 * §5's MVP tool ceiling — "none — full pair ships" for Fitness, including
 * the one Tier 2+ write tool at MVP (`cancel_scheduled_workout`).
 */
const FITNESS_PAIR = ['fitness_performance', 'training_safety'];
const MAX_RAW_ITEMS = 30;

interface CountArgs {
  count: number;
}
interface SessionIdArgs {
  sessionId: string;
}

function validateCount(args: unknown, max: number, fallback: number): CountArgs {
  return { count: validateBoundedNumber(args, 'count', { min: 1, max, fallback }) };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateSessionId(args: unknown): SessionIdArgs {
  const sessionId = (args as Record<string, unknown>)?.sessionId;
  if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId)) {
    throw new Error('sessionId must be a UUID');
  }
  return { sessionId };
}

export const getTrainingLoadBaseline: ScopedToolContract<Record<string, never>, unknown> = {
  name: 'get_training_load_baseline',
  domain: 'fitness',
  dataClass: 'derived',
  riskTier: 0,
  requiredScope: 'fitness.read',
  callableBy: FITNESS_PAIR,
  description: "Read the user's training-load baseline deviation.",
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  validate: () => ({}),
  requiresConfirmation: () => false,
  async execute(ctx) {
    // FINDING (security review, docs/09 Milestone 7): `baselines` is
    // keyed UNIQUE (user_id, domain, metric, window_days) — this query
    // had no window_days filter or ordering, unlike every sibling
    // baseline tool, so if the worker ever computes this metric at more
    // than one window it would return whichever row Postgres happened to
    // return first. `ORDER BY computed_at DESC LIMIT 1` makes "most
    // recently computed" an explicit choice instead of an accident, at
    // MVP scale (one fixed window) with no behavior change.
    const row = await ctx.client.query(
      `SELECT mean, stddev, current_value, deviation_z, classification, computed_at
       FROM baselines WHERE user_id = $1 AND domain = 'fitness' AND metric = 'training_load'
       ORDER BY computed_at DESC LIMIT 1`,
      [ctx.userId],
    );
    return row.rows[0] ?? null;
  },
};

export const getRecentTrainingSummary: ScopedToolContract<CountArgs, unknown[]> = {
  name: 'get_recent_training_summary',
  domain: 'fitness',
  dataClass: 'derived',
  riskTier: 0,
  requiredScope: 'fitness.read',
  callableBy: FITNESS_PAIR,
  description: "Read the user's most recent training sessions (summary level: sport, duration, load — not per-set detail).",
  inputSchema: { type: 'object', properties: { count: { type: 'integer', minimum: 1, maximum: MAX_RAW_ITEMS } } },
  validate: (args) => validateCount(args, MAX_RAW_ITEMS, 10),
  requiresConfirmation: () => false,
  async execute(ctx, args) {
    const rows = await ctx.client.query(
      `SELECT e.id AS session_id, e.starts_at, e.status, f.sport_type, f.duration_min, f.training_load, f.perceived_exertion
       FROM events e JOIN event_fitness_session f ON f.event_id = e.id
       WHERE e.user_id = $1 AND e.domain = 'fitness'
       ORDER BY e.starts_at DESC LIMIT $2`,
      [ctx.userId, args.count],
    );
    return rows.rows;
  },
};

export const getRecentTrainingRaw: ScopedToolContract<SessionIdArgs, unknown[]> = {
  name: 'get_recent_training_raw',
  domain: 'fitness',
  dataClass: 'raw',
  riskTier: 0,
  requiredScope: 'fitness.read_raw',
  callableBy: FITNESS_PAIR,
  description: 'Read per-set volume/intensity detail for one training session.',
  inputSchema: { type: 'object', required: ['sessionId'], properties: { sessionId: { type: 'string' } } },
  validate: validateSessionId,
  requiresConfirmation: () => false,
  async execute(ctx, args) {
    const rows = await ctx.client.query(
      `SELECT s.exercise_name, s.set_number, s.reps, s.weight_kg, s.rpe
       FROM fitness_session_set s
       JOIN events e ON e.id = s.event_id
       WHERE e.user_id = $1 AND s.event_id = $2
       ORDER BY s.exercise_name, s.set_number`,
      [ctx.userId, args.sessionId],
    );
    return rows.rows;
  },
};

export const getActiveInjuryFlags: ScopedToolContract<Record<string, never>, unknown[]> = {
  name: 'get_active_injury_flags',
  domain: 'fitness',
  dataClass: 'derived',
  riskTier: 0,
  requiredScope: 'fitness.read',
  callableBy: ['training_safety'],
  description: "Read the user's currently-active, user-flagged injury flags (docs/08 §4.1: user-entered only at MVP).",
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  validate: () => ({}),
  requiresConfirmation: () => false,
  async execute(ctx) {
    const rows = await ctx.client.query(
      `SELECT i.body_part, i.severity, i.flagged_by, i.started_at
       FROM observations o JOIN observation_injury_flag i ON i.observation_id = o.id
       WHERE o.user_id = $1 AND i.active = true
       ORDER BY i.started_at DESC`,
      [ctx.userId],
    );
    return rows.rows;
  },
};

export const cancelScheduledWorkout: ScopedToolContract<SessionIdArgs, { cancelled: boolean }> = {
  name: 'cancel_scheduled_workout',
  domain: 'fitness',
  dataClass: 'write',
  riskTier: 2,
  requiredScope: 'fitness.write',
  callableBy: ['fitness_performance'],
  description: "Cancel a specific planned (not-yet-completed) workout session. Requires explicit user confirmation.",
  inputSchema: { type: 'object', required: ['sessionId'], properties: { sessionId: { type: 'string' } } },
  validate: validateSessionId,
  requiresConfirmation: () => true,
  async execute(ctx, args) {
    // docs/03 §2.7 / T3's must-fix: user_id is taken only from
    // RequestContext (ctx.userId, itself resolved server-side from the
    // verified session), never trusted from the argument — the WHERE
    // clause below is the ownership re-check T3 names as the one IDOR
    // test target that actually exists at MVP, on top of RLS already
    // scoping the UPDATE to this user's own rows.
    const updated = await ctx.client.query(
      `UPDATE events SET status = 'cancelled', updated_at = now()
       WHERE id = $1 AND user_id = $2 AND domain = 'fitness' AND status = 'planned'
       RETURNING id`,
      [args.sessionId, ctx.userId],
    );
    if (updated.rowCount === 0) {
      // Not a thrown error: the tool ran correctly and determined there is
      // nothing to cancel (already cancelled/completed, or someone else's
      // id — RLS plus the explicit user_id check above already make the
      // latter impossible). The controller maps this to 404.
      return { cancelled: false };
    }

    const actionSpine = await ctx.client.query(
      `INSERT INTO core_objects (user_id, object_type, source, is_user_entered)
       VALUES ($1, 'action', 'life_master_agent', false) RETURNING id`,
      [ctx.userId],
    );
    const actionId: string = actionSpine.rows[0].id;
    await ctx.client.query(
      `INSERT INTO actions (id, user_id, domain, action_type, executed_by, risk_tier, status)
       VALUES ($1, $2, 'fitness', 'workout_cancellation', 'agent_on_behalf_of_user', 2, 'completed')`,
      [actionId, ctx.userId],
    );

    return { cancelled: true };
  },
};

export const FITNESS_TOOLS = [
  getTrainingLoadBaseline,
  getRecentTrainingSummary,
  getRecentTrainingRaw,
  getActiveInjuryFlags,
  cancelScheduledWorkout,
];
