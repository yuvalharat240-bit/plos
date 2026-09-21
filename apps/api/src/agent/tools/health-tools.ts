import { ScopedToolContract } from '../contracts/scoped-tool';
import { VITAL_TYPES } from '../../sync/dto/health-sync.dto';
import { validateBoundedNumber } from './tools-validation';

/**
 * docs/05-agent-architecture.md §3.1, narrowed to docs/08-mvp-definition.md
 * §5's MVP tool ceiling: `get_active_symptom_flags`, `get_lab_result_summary`,
 * `get_recent_lab_results_raw` are deliberately NOT registered here — no
 * MVP write path populates `observation_symptom`/`observation_lab_result`
 * (08 §4.2), and an unregistered tool can't be over-called by construction,
 * matching this codebase's existing "no tool exists" discipline rather
 * than registering a tool that would only ever return empty.
 */
const HEALTH_PAIR = ['health_analysis', 'health_safety'];
const MAX_RAW_ITEMS = 30;

interface WindowArgs {
  windowDays: number;
}
interface VitalWindowArgs extends WindowArgs {
  vitalType: string;
}
interface RawCountArgs {
  count: number;
}
interface RawVitalArgs {
  vitalType: string;
  days: number;
}

function validateWindowDays(args: unknown): WindowArgs {
  return { windowDays: validateBoundedNumber(args, 'windowDays', { min: 1, max: 90, fallback: 14 }) };
}

function validateCount(args: unknown, max: number): RawCountArgs {
  return { count: validateBoundedNumber(args, 'count', { min: 1, max, fallback: 7 }) };
}

export const getSleepBaselineDeviation: ScopedToolContract<WindowArgs, unknown> = {
  name: 'get_sleep_baseline_deviation',
  domain: 'health',
  dataClass: 'derived',
  riskTier: 0,
  requiredScope: 'health.read',
  callableBy: HEALTH_PAIR,
  description: "Read the user's sleep-duration baseline deviation (mean/stddev/current/z-score/classification).",
  inputSchema: { type: 'object', properties: { windowDays: { type: 'integer', minimum: 1, maximum: 90 } } },
  validate: validateWindowDays,
  requiresConfirmation: () => false,
  async execute(ctx, args) {
    const row = await ctx.client.query(
      `SELECT mean, stddev, current_value, deviation_z, classification, computed_at
       FROM baselines WHERE user_id = $1 AND domain = 'health' AND metric = 'sleep_duration_min' AND window_days = $2`,
      [ctx.userId, args.windowDays],
    );
    return row.rows[0] ?? null;
  },
};

export const getVitalBaselineDeviation: ScopedToolContract<VitalWindowArgs, unknown> = {
  name: 'get_vital_baseline_deviation',
  domain: 'health',
  dataClass: 'derived',
  riskTier: 0,
  requiredScope: 'health.read',
  callableBy: HEALTH_PAIR,
  description: "Read the user's baseline deviation for one vital type.",
  inputSchema: {
    type: 'object',
    required: ['vitalType'],
    properties: { vitalType: { type: 'string', enum: VITAL_TYPES }, windowDays: { type: 'integer', minimum: 1, maximum: 90 } },
  },
  validate(args) {
    const vitalType = (args as Record<string, unknown>)?.vitalType;
    if (typeof vitalType !== 'string' || !VITAL_TYPES.includes(vitalType)) {
      throw new Error('vitalType must be one of the known observation_vital types');
    }
    return { ...validateWindowDays(args), vitalType };
  },
  requiresConfirmation: () => false,
  async execute(ctx, args) {
    const row = await ctx.client.query(
      `SELECT mean, stddev, current_value, deviation_z, classification, computed_at
       FROM baselines WHERE user_id = $1 AND domain = 'health' AND metric = $2 AND window_days = $3`,
      [ctx.userId, args.vitalType, args.windowDays],
    );
    return row.rows[0] ?? null;
  },
};

export const getRecentSleepRaw: ScopedToolContract<RawCountArgs, unknown[]> = {
  name: 'get_recent_sleep_raw',
  domain: 'health',
  dataClass: 'raw',
  riskTier: 0,
  requiredScope: 'health.read_raw',
  callableBy: HEALTH_PAIR,
  description: "Read the user's most recent raw sleep sessions (bounded).",
  inputSchema: { type: 'object', properties: { count: { type: 'integer', minimum: 1, maximum: MAX_RAW_ITEMS } } },
  validate: (args) => validateCount(args, MAX_RAW_ITEMS),
  requiresConfirmation: () => false,
  async execute(ctx, args) {
    const rows = await ctx.client.query(
      `SELECT o.observed_at, s.sleep_start, s.sleep_end, s.duration_min, s.sleep_score
       FROM observations o JOIN observation_sleep s ON s.observation_id = o.id
       WHERE o.user_id = $1 AND o.domain = 'health' AND o.observation_type = 'sleep'
       ORDER BY o.observed_at DESC LIMIT $2`,
      [ctx.userId, args.count],
    );
    return rows.rows;
  },
};

export const getRecentVitalsRaw: ScopedToolContract<RawVitalArgs, unknown[]> = {
  name: 'get_recent_vitals_raw',
  domain: 'health',
  dataClass: 'raw',
  riskTier: 0,
  requiredScope: 'health.read_raw',
  callableBy: HEALTH_PAIR,
  description: "Read the user's most recent raw vital readings of one type (bounded).",
  inputSchema: {
    type: 'object',
    required: ['vitalType'],
    properties: { vitalType: { type: 'string', enum: VITAL_TYPES }, days: { type: 'integer', minimum: 1, maximum: MAX_RAW_ITEMS } },
  },
  validate(args) {
    const vitalType = (args as Record<string, unknown>)?.vitalType;
    if (typeof vitalType !== 'string' || !VITAL_TYPES.includes(vitalType)) {
      throw new Error('vitalType must be one of the known observation_vital types');
    }
    const days = Number((args as Record<string, unknown>)?.days ?? 7);
    if (!Number.isFinite(days) || days < 1 || days > MAX_RAW_ITEMS) {
      throw new Error(`days must be between 1 and ${MAX_RAW_ITEMS}`);
    }
    return { vitalType, days };
  },
  requiresConfirmation: () => false,
  async execute(ctx, args) {
    const rows = await ctx.client.query(
      `SELECT o.observed_at, v.value_numeric, v.unit
       FROM observations o JOIN observation_vital v ON v.observation_id = o.id
       WHERE o.user_id = $1 AND o.domain = 'health' AND v.vital_type = $2
         AND o.observed_at >= now() - ($3 || ' days')::interval
       ORDER BY o.observed_at DESC`,
      [ctx.userId, args.vitalType, args.days],
    );
    return rows.rows;
  },
};

export const getHealthProfileSummary: ScopedToolContract<Record<string, never>, unknown> = {
  name: 'get_health_profile_summary',
  domain: 'health',
  dataClass: 'derived',
  riskTier: 0,
  requiredScope: 'health.read',
  callableBy: HEALTH_PAIR,
  description: "Read the user's curated health profile (allergies, chronic conditions, current medications by name — not raw clinical records).",
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  validate: () => ({}),
  requiresConfirmation: () => false,
  async execute(ctx) {
    const row = await ctx.client.query(
      `SELECT allergies, chronic_conditions, medications_current, blood_type
       FROM health_profile WHERE user_id = $1`,
      [ctx.userId],
    );
    return row.rows[0] ?? null;
  },
};

export const HEALTH_TOOLS = [
  getSleepBaselineDeviation,
  getVitalBaselineDeviation,
  getRecentSleepRaw,
  getRecentVitalsRaw,
  getHealthProfileSummary,
];
