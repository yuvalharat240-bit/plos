import { ScopedToolContract } from '../contracts/scoped-tool';
import { MVP_DOMAINS } from '../specialists/specialist-roster';

/**
 * docs/05-agent-architecture.md §5 — the Life Master Agent's ONLY tool
 * (docs/03 §2.4 reaffirmed: it never calls a domain Scoped Tool directly).
 * `timeline_entries` is deliberately not read here — docs/08-mvp-definition.md
 * §4.2 stubs it at MVP (zero write path exists yet), so querying it would
 * only ever return an empty array; omitted rather than shipping dead code
 * that always reads nothing, per this project's own "no tool exists for a
 * capability with no MVP path" discipline.
 *
 * §5's own text: a domain the caller's `permission_grants` doesn't
 * authorize is simply omitted and logged, not an error — this is ordinary
 * least-privilege filtering, distinct from the disagreement-surfacing rule
 * (§8), which is about findings, not access.
 */
interface ContextSnapshotArgs {
  domains: string[];
}

function validate(args: unknown): ContextSnapshotArgs {
  const domains = (args as Record<string, unknown>)?.domains;
  if (!Array.isArray(domains) || domains.length === 0 || !domains.every((d) => typeof d === 'string')) {
    throw new Error('domains must be a non-empty string array');
  }
  const unknownDomains = domains.filter((d) => !MVP_DOMAINS.includes(d));
  if (unknownDomains.length > 0) {
    throw new Error(`unrecognized domain(s): ${unknownDomains.join(', ')}`);
  }
  return { domains };
}

export const getContextSnapshot: ScopedToolContract<ContextSnapshotArgs, unknown> = {
  name: 'get_context_snapshot',
  domain: '*',
  dataClass: 'derived',
  riskTier: 0,
  requiredScope: 'agent.ask',
  callableBy: ['life_master_agent'],
  description: 'Read precomputed, derived context (baselines, cross-domain memory digest) for the requested domains.',
  inputSchema: {
    type: 'object',
    required: ['domains'],
    properties: { domains: { type: 'array', items: { type: 'string', enum: MVP_DOMAINS } } },
  },
  validate,
  requiresConfirmation: () => false,
  async execute(ctx, args) {
    const authorizedDomains: string[] = [];
    const omittedDomains: string[] = [];
    for (const domain of args.domains) {
      if (ctx.scopes.includes(`${domain}.read`)) {
        authorizedDomains.push(domain);
      } else {
        omittedDomains.push(domain);
      }
    }

    // docs/08 §2.4 / §5: the passive productivity calendar-density signal
    // is read the same way as any other domain's baseline, gated on the
    // same `productivity.read` scope, without ever dispatching a
    // Productivity specialist.
    const includeProductivity = ctx.scopes.includes('productivity.read');
    if (!includeProductivity) omittedDomains.push('productivity');

    // FINDING (security review, docs/09 Milestone 7): this used to be up
    // to 4 sequential round trips to `baselines` (one per authorized
    // domain, plus a separate one for productivity) on the hottest path
    // in the whole agent stack — every single `/v1/agent/ask` call goes
    // through this tool. One query, grouped by domain in JS, instead.
    const domainSnapshots: Array<{ domain: string; baselines: unknown[] }> = [];
    if (authorizedDomains.length > 0 || includeProductivity) {
      const rows = await ctx.client.query(
        `SELECT domain, metric, mean, stddev, current_value, deviation_z, classification, window_days
         FROM baselines
         WHERE user_id = $1
           AND (
             domain = ANY($2)
             OR (domain = 'productivity' AND metric = 'calendar_density_next_day' AND $3)
           )`,
        [ctx.userId, authorizedDomains, includeProductivity],
      );
      const byDomain = new Map<string, unknown[]>();
      for (const row of rows.rows) {
        const list = byDomain.get(row.domain) ?? [];
        list.push(row);
        byDomain.set(row.domain, list);
      }
      for (const domain of includeProductivity ? [...authorizedDomains, 'productivity'] : authorizedDomains) {
        domainSnapshots.push({ domain, baselines: byDomain.get(domain) ?? [] });
      }
    }

    const memoryDigest = await ctx.client.query(
      `SELECT statement, polarity, memory_class FROM memories
       WHERE user_id = $1 AND status = 'active' ORDER BY updated_at DESC LIMIT 20`,
      [ctx.userId],
    );

    return { domains: domainSnapshots, memoryDigest: memoryDigest.rows, omittedDomains };
  },
};
