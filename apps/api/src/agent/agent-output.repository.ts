import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AgentOutput, AgentOutputEvidence, EpistemicStatus } from './contracts/agent-output';
import { AGENT_VERSION } from './specialists/specialist-roster';

/**
 * docs/05-agent-architecture.md §2.1 — the persistence mapping, split
 * across the shared `core_objects` spine row and the `agent_outputs`
 * extension row (docs/04-database-schema.md §5).
 */
@Injectable()
export class AgentOutputRepository {
  /** One conversation + one user turn per ask request. docs/08-mvp-definition.md
   * §4.1 requires `agent_conversations`/`agent_turns` populated in full at
   * MVP; MVP has no cross-request conversation continuity UI yet (AskView's
   * "follow-up" bar isn't wired to thread a prior conversation id — a real,
   * flagged limitation, not silently assumed), so each ask starts its own
   * conversation rather than trying to guess which prior one to append to. */
  async startConversation(
    client: PoolClient,
    userId: string,
    question: string,
  ): Promise<{ conversationId: string; userTurnId: string }> {
    const conversation = await client.query(
      `INSERT INTO agent_conversations (user_id) VALUES ($1) RETURNING id`,
      [userId],
    );
    const conversationId: string = conversation.rows[0].id;
    const userTurn = await client.query(
      `INSERT INTO agent_turns (conversation_id, role, content) VALUES ($1, 'user', $2) RETURNING id`,
      [conversationId, question],
    );
    return { conversationId, userTurnId: userTurn.rows[0].id };
  }

  async recordAssistantTurn(
    client: PoolClient,
    conversationId: string,
    content: string,
    toolsUsed: string[],
  ): Promise<string> {
    const turn = await client.query(
      `INSERT INTO agent_turns (conversation_id, role, content, tool_calls) VALUES ($1, 'assistant', $2, $3) RETURNING id`,
      [conversationId, content, JSON.stringify(toolsUsed)],
    );
    return turn.rows[0].id;
  }

  async endConversation(client: PoolClient, conversationId: string): Promise<void> {
    await client.query(`UPDATE agent_conversations SET ended_at = now() WHERE id = $1`, [conversationId]);
  }

  /** Persists one AgentOutput, returning its id (== the shared spine id). */
  async persist(
    client: PoolClient,
    userId: string,
    conversationTurnId: string,
    output: AgentOutput,
  ): Promise<string> {
    const epistemicStatus = AgentOutputRepository.epistemicStatusOf(output);
    const spine = await client.query(
      `INSERT INTO core_objects (user_id, object_type, epistemic_status, source, is_ai_derived, confidence, agent_version, is_user_entered)
       VALUES ($1, 'agent_output', $2, $3, true, $4, $5, false)
       RETURNING id`,
      [userId, epistemicStatus, output.agentName, output.confidence, AGENT_VERSION],
    );
    const id: string = spine.rows[0].id;

    await client.query(
      `INSERT INTO agent_outputs
         (id, user_id, conversation_turn_id, agent_name, model_version, prompt_version, finding, evidence,
          uncertainty, recommendation, requires_human_review, requires_user_confirmation, risk_tier,
          data_timestamp, tools_used, disagrees_with_output_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        id,
        userId,
        conversationTurnId,
        output.agentName,
        output.modelVersion,
        output.promptVersion,
        output.finding,
        JSON.stringify(output.evidence),
        output.uncertainty,
        output.recommendation,
        output.requiresHumanReview,
        output.requiresUserConfirmation,
        output.riskTier,
        output.dataTimestamp,
        output.toolsUsed,
        output.disagreesWithOutputId,
      ],
    );

    return id;
  }

  /** docs/05 §2.2 — only for the Life Master Agent's own composed answer
   * aggregating other agent outputs. */
  async recordCompositionSources(client: PoolClient, outputId: string, sourceOutputIds: string[]): Promise<void> {
    for (const sourceOutputId of sourceOutputIds) {
      await client.query(
        `INSERT INTO agent_output_sources (output_id, source_output_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [outputId, sourceOutputId],
      );
    }
  }

  /** docs/05 §2.2's computed sources[] — evidence's own core_object_ids
   * plus, for a composed answer, every specialist output id that fed it. */
  async resolveSources(client: PoolClient, outputId: string, evidence: AgentOutput['evidence']): Promise<string[]> {
    const composed = await client.query(
      `SELECT source_output_id FROM agent_output_sources WHERE output_id = $1`,
      [outputId],
    );
    const sources = new Set<string>(evidence.map((e) => e.coreObjectId));
    for (const row of composed.rows) {
      sources.add(row.source_output_id as string);
    }
    return Array.from(sources);
  }

  /** The output's own tag — same rule `persist()` already applies when
   * writing `core_objects.epistemic_status` for an `agent_output` row
   * (never `fact`/`derived_fact`: those only ever originate from raw
   * sync data or the baseline engine, docs/04:617,746). Exposed as its
   * own function (not just inlined in `persist`) so the wire response can
   * compute the identical tag without re-deriving the rule. */
  static epistemicStatusOf(output: Pick<AgentOutput, 'recommendation'>): EpistemicStatus {
    return output.recommendation !== null ? 'recommendation' : 'ai_inference';
  }

  /**
   * FINDING (pre-Milestone-8 audit, 2026-09-21): CLAUDE.md's non-negotiable
   * "AI inference must never be presented as fact (FACT / DERIVED FACT /
   * AI INFERENCE / RECOMMENDATION are distinct)" was enforced at the DB
   * layer (`core_objects.epistemic_status`) but never reached the wire —
   * `AgentOutputEvidence` cited other core_objects by id with no tag, and
   * with no core-objects read endpoint the client had no way to resolve
   * one. A composed answer's evidence can legitimately mix a raw HealthKit
   * `fact`, a Personal Baseline Engine `derived_fact`, and this agent's own
   * `ai_inference` in the same list (docs/04:202-207) — all three arrived
   * at the client identically shaped. This resolves each evidence item's
   * real tag in one query rather than leaving it to the model's prose.
   */
  async attachEvidenceEpistemicStatus(
    client: PoolClient,
    evidence: AgentOutputEvidence[],
  ): Promise<Array<AgentOutputEvidence & { epistemicStatus: EpistemicStatus }>> {
    if (evidence.length === 0) return [];
    const ids = evidence.map((e) => e.coreObjectId);
    const rows = await client.query(`SELECT id, epistemic_status FROM core_objects WHERE id = ANY($1)`, [ids]);
    const statusById = new Map<string, EpistemicStatus>(
      rows.rows.map((r) => [r.id as string, r.epistemic_status as EpistemicStatus]),
    );
    return evidence.map((e) => ({
      ...e,
      // Falls back to `ai_inference` only if the referenced core_object
      // was deleted/inaccessible between evidence assembly and this
      // lookup — never silently claims `fact`.
      epistemicStatus: statusById.get(e.coreObjectId) ?? 'ai_inference',
    }));
  }
}
