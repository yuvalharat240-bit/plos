/**
 * docs/05-agent-architecture.md §3 (roster) narrowed to
 * docs/08-mvp-definition.md §2.2's three in-scope pairs. `domain_key` per
 * agent is fixed here once and reused everywhere an agent's own domain
 * needs to be resolved server-side (common tools, §4 — "the `domain`
 * argument is validated server-side against the calling agent's
 * registered `domain_key`, not trusted from the argument alone").
 */
export type AgentName =
  | 'life_master_agent'
  | 'health_analysis'
  | 'health_safety'
  | 'fitness_performance'
  | 'training_safety'
  | 'mental_context'
  | 'clinical_safety_handoff';

export const AGENT_DOMAIN: Record<Exclude<AgentName, 'life_master_agent'>, string> = {
  health_analysis: 'health',
  health_safety: 'health',
  fitness_performance: 'fitness',
  training_safety: 'fitness',
  mental_context: 'mental_health',
  clinical_safety_handoff: 'mental_health',
};

export type SpecialistAgentName = Exclude<AgentName, 'life_master_agent'>;

/**
 * FINDING (security review, docs/09 Milestone 7): this exact resolution
 * ("look up AGENT_DOMAIN, throw if the agent isn't registered") used to
 * be defined independently in `common-tools.ts`, and re-implemented a
 * second time — WITHOUT the throw — in `tool-executor.service.ts`'s own
 * `commonToolScope`, which meant an unrecognized agent name there
 * silently produced the nonsense scope string "undefined.read" instead
 * of failing loudly. One definition, in the module that owns
 * `AGENT_DOMAIN` itself, used by both call sites now.
 */
export function domainOf(agentName: string): string {
  const domain = AGENT_DOMAIN[agentName as SpecialistAgentName];
  if (!domain) {
    throw new Error(`agent has no registered domain: ${agentName}`);
  }
  return domain;
}

export interface SpecialistPair {
  domain: string;
  primary: SpecialistAgentName;
  secondary: SpecialistAgentName;
}

/** docs/05 §1: pairs run sequentially — primary first, its complete
 * output feeds the secondary. docs/08 §2.2: the three MVP pairs, all
 * dispatched as full pairs (§2.3's reduction is about which *tools*
 * ship, not about skipping the pair-mate). */
export const MVP_PAIRS: SpecialistPair[] = [
  { domain: 'health', primary: 'health_analysis', secondary: 'health_safety' },
  { domain: 'fitness', primary: 'fitness_performance', secondary: 'training_safety' },
  { domain: 'mental_health', primary: 'mental_context', secondary: 'clinical_safety_handoff' },
];

export const MVP_DOMAINS = MVP_PAIRS.map((p) => p.domain);

/** docs/03 §2.4 / §7's cheap-model routing principle: intent
 * classification and the disagreement backstop don't need the expensive
 * reasoning pass a specialist's actual analysis does. Real model ids
 * (docs/02 ADR D3's ModelProvider is model-agnostic; these are today's
 * concrete choice), overridable so a later model swap is a config change,
 * not a code change. */
export const MODEL_IDS = {
  cheap: process.env.PLOS_AGENT_CHEAP_MODEL ?? 'claude-haiku-4-5-20251001',
  reasoning: process.env.PLOS_AGENT_REASONING_MODEL ?? 'claude-sonnet-5',
};

export const AGENT_VERSION = 'plos-agent-v1';
export const PROMPT_VERSION = 'plos-prompt-v1';
