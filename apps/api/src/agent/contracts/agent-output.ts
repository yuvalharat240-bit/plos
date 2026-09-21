/**
 * docs/05-agent-architecture.md §2 — the exact wire/runtime contract every
 * specialist call and the Life Master Agent's own composed answer return.
 * `confidence` and `agent_version` are deliberately absent here even
 * though the vision's field list includes them: §2.1 maps both onto the
 * shared `core_objects` spine row instead of a duplicate column on
 * `agent_outputs`, so they live on `PersistedAgentOutput` (added by the
 * repository at persistence time), not on this in-flight shape.
 */
export interface AgentOutput {
  finding: string;
  evidence: AgentOutputEvidence[];
  uncertainty: string[];
  recommendation: string | null;
  requiresHumanReview: boolean;
  requiresUserConfirmation: boolean;

  agentName: string;
  modelVersion: string;
  promptVersion: string;
  dataTimestamp: string; // ISO 8601 — oldest data point the finding depends on
  toolsUsed: string[];

  riskTier: 0 | 1 | 2 | 3 | 4;
  disagreesWithOutputId: string | null;

  /** §2.1's `confidence` (0-1), lives on core_objects but is part of the
   * in-flight contract every caller needs to reason about disagreement/
   * composition — carried here, mapped to the spine row at persistence. */
  confidence: number;
}

export interface AgentOutputEvidence {
  coreObjectId: string;
  description: string;
}

/** docs/04-database-schema.md:150-152's `epistemic_status` enum — the
 * CLAUDE.md non-negotiable ("AI inference must never be presented as fact")
 * made concrete. Every output/evidence item the client receives must carry
 * one of these four tags; see EpistemicallyTaggedOutput. */
export type EpistemicStatus = 'fact' | 'derived_fact' | 'ai_inference' | 'recommendation';
