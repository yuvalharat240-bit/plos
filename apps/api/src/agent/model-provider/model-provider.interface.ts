/**
 * ADR D3 (docs/02-architecture-decision-record.md) — "every specialist and
 * the orchestrator itself talks to a ModelProvider interface (generate(),
 * embedding())... only that one implementation file should ever import
 * the SDK." This file is that interface. See
 * `anthropic-model-provider.service.ts` for which SDK actually backs it,
 * and that file's header comment for a real, documented deviation from
 * ADR D3's literal package name.
 */
export const MODEL_PROVIDER = Symbol('MODEL_PROVIDER');

export interface ModelToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ModelToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ModelToolResult {
  toolCallId: string;
  content: string;
  isError: boolean;
}

export type ToolCallHandler = (call: ModelToolCall) => Promise<ModelToolResult>;

export interface ClassifyIntentInput {
  question: string;
  availableDomains: string[];
}

export interface ClassifyIntentResult {
  domains: string[];
  modelVersion: string;
}

/** The exact shape a specialist's terminal `submit_finding` tool call
 * carries — everything in docs/05 §2's AgentOutput except the provenance
 * fields the orchestrator fills in itself (agentName, toolsUsed,
 * dataTimestamp is specialist-supplied since only it knows which data it
 * actually looked at). */
export interface SpecialistFinding {
  finding: string;
  evidence: Array<{ coreObjectId: string; description: string }>;
  confidence: number;
  uncertainty: string[];
  recommendation: string | null;
  requiresHumanReview: boolean;
  requiresUserConfirmation: boolean;
  riskTier: 0 | 1 | 2 | 3 | 4;
  dataTimestamp: string;
  /** Self-declared disagreement (05 §8 mechanism 1) — set by a second-in-
   * pair agent only; the id it disagrees with is resolved by the caller
   * (the specialist doesn't know the persisted id yet), so this carries a
   * boolean + note, not an id. */
  disagreesWithPrimary?: { disagrees: boolean; note?: string };
  /** API-response-layer addition, not part of docs/05 §2's persisted
   * contract — mirrors the same "computed at serialization time, not
   * stored" precedent §2.2 already sets for `sources[]`. Set only by
   * `fitness_performance` when its finding/recommendation concretely
   * implies cancelling one specific planned session, so the client has an
   * id to hand back to the confirm endpoint (see AgentController) without
   * scraping prose. */
  actionableSessionId?: string;
}

export interface RunSpecialistInput {
  agentName: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  tools: ModelToolDefinition[];
  maxTurns?: number;
}

export interface RunSpecialistResult {
  finding: SpecialistFinding;
  toolsUsed: string[];
  modelVersion: string;
}

export interface DisagreementCheckInput {
  primary: { finding: string; recommendation: string | null; requiresHumanReview: boolean; riskTier: number };
  secondary: { finding: string; recommendation: string | null; requiresHumanReview: boolean; riskTier: number };
}

export interface DisagreementCheckResult {
  mismatch: boolean;
  note: string | null;
  modelVersion: string;
}

export interface ModelProvider {
  classifyIntent(input: ClassifyIntentInput): Promise<ClassifyIntentResult>;

  /** Runs one agent (a specialist, or the Life Master Agent's own
   * composition pass with `tools: []`) to completion, calling
   * `onToolCall` for every tool invocation the model makes along the way,
   * and returns once the model calls the mandatory terminal
   * `submit_finding` tool. */
  runSpecialist(input: RunSpecialistInput, onToolCall: ToolCallHandler): Promise<RunSpecialistResult>;

  /** 05 §8 mechanism 2 — the orchestrator backstop, independent of
   * self-declaration. */
  detectDisagreement(input: DisagreementCheckInput): Promise<DisagreementCheckResult>;

  /** ADR D3 declares this half of the interface; docs/08-mvp-definition.md
   * §9.1 defers ever calling it at MVP. Implementations must still exist
   * (the interface is the swappability point) but are never expected to
   * be exercised — see the concrete provider's own comment. */
  embedding(text: string): Promise<number[]>;
}
