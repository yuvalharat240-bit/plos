import { ScopedToolContract, ToolExecutionContext } from '../contracts/scoped-tool';
import { domainOf } from '../specialists/specialist-roster';

/**
 * docs/05-agent-architecture.md §4 — identical shape across every domain,
 * defined once. Every one of these resolves its `domain` from the calling
 * agent's own registered `domain_key` (never from a model-supplied
 * argument, per §4's own security note), which is also why none of these
 * take a `domain` field in their input schema at all — there is nothing
 * for the model to even attempt to override.
 */
const EMPTY_SCHEMA = { type: 'object', properties: {}, additionalProperties: false } as const;

export const getDomainGoals: ScopedToolContract<Record<string, never>, unknown[]> = {
  name: 'get_domain_goals',
  domain: '*',
  dataClass: 'derived',
  riskTier: 0,
  requiredScope: '', // resolved per-domain at call time — see ToolExecutorService
  callableBy: ['health_analysis', 'health_safety', 'fitness_performance', 'training_safety', 'mental_context', 'clinical_safety_handoff'],
  description: "Read the user's active goals in this agent's own domain.",
  inputSchema: EMPTY_SCHEMA,
  validate: () => ({}),
  requiresConfirmation: () => false,
  async execute(ctx: ToolExecutionContext) {
    const domain = domainOf(ctx.agentName);
    const rows = await ctx.client.query(
      `SELECT g.id, g.title, g.goal_type, g.target_metric, g.target_value, g.target_date, g.priority
       FROM goals g WHERE g.user_id = $1 AND g.domain = $2 AND g.status = 'active'
       ORDER BY g.priority NULLS LAST, g.created_at DESC LIMIT 20`,
      [ctx.userId, domain],
    );
    return rows.rows;
  },
};

export const getDomainMemoryDigest: ScopedToolContract<Record<string, never>, unknown[]> = {
  name: 'get_domain_memory_digest',
  domain: '*',
  dataClass: 'derived',
  riskTier: 0,
  requiredScope: '',
  callableBy: ['health_analysis', 'health_safety', 'fitness_performance', 'training_safety', 'mental_context', 'clinical_safety_handoff'],
  description: "Read structured memory (preferences, patterns, reasons — not raw text) in this agent's own domain.",
  inputSchema: EMPTY_SCHEMA,
  validate: () => ({}),
  requiresConfirmation: () => false,
  async execute(ctx: ToolExecutionContext) {
    // ponytail: `memories` carries no `domain` column (docs/08 §4.1 — it's
    // manual/user-edited only at MVP, no automated per-domain extraction
    // pipeline exists to tag one). A true per-domain digest isn't
    // possible with the current schema; this returns the user's whole
    // active manual memory set to every specialist rather than a
    // false-precision per-domain slice this schema can't actually back.
    // Flagged as a real MVP-scale limitation, not silently narrowed.
    void domainOf(ctx.agentName);
    const rows = await ctx.client.query(
      `SELECT m.id, m.statement, m.polarity, m.memory_class,
              coalesce(
                jsonb_agg(jsonb_build_object('type', r.reason_type, 'text', r.reason_text, 'polarity', r.polarity))
                  FILTER (WHERE r.id IS NOT NULL),
                '[]'
              ) AS reasons
       FROM memories m
       LEFT JOIN memory_reasons r ON r.memory_id = m.id
       WHERE m.user_id = $1 AND m.status = 'active'
       GROUP BY m.id
       ORDER BY m.updated_at DESC LIMIT 20`,
      [ctx.userId],
    );
    return rows.rows;
  },
};

export const getDomainRecentOutcomes: ScopedToolContract<Record<string, never>, unknown[]> = {
  name: 'get_domain_recent_outcomes',
  domain: '*',
  dataClass: 'derived',
  riskTier: 0,
  requiredScope: '',
  callableBy: ['health_analysis', 'health_safety', 'fitness_performance', 'training_safety', 'mental_context', 'clinical_safety_handoff'],
  description: "Read recent Outcome Learning Loop results (past actions/decisions and how they went) in this agent's own domain.",
  inputSchema: EMPTY_SCHEMA,
  validate: () => ({}),
  requiresConfirmation: () => false,
  async execute(ctx: ToolExecutionContext) {
    const domain = domainOf(ctx.agentName);
    const rows = await ctx.client.query(
      `SELECT o.id, o.outcome_type, o.success_signal, o.measured_at, o.notes
       FROM outcomes o
       JOIN actions a ON a.id = o.outcome_of_id
       WHERE o.user_id = $1 AND a.domain = $2
       ORDER BY o.measured_at DESC LIMIT 10`,
      [ctx.userId, domain],
    );
    return rows.rows;
  },
};

export const COMMON_TOOLS = [getDomainGoals, getDomainMemoryDigest, getDomainRecentOutcomes];
