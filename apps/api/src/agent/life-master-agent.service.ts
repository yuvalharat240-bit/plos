import { Inject, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { MODEL_PROVIDER, ModelProvider } from './model-provider/model-provider.interface';
import { ToolExecutorService } from './tools/tool-executor.service';
import { SpecialistDispatcherService } from './specialists/specialist-dispatcher.service';
import { DisagreementService } from './disagreement.service';
import { AgentOutputRepository } from './agent-output.repository';
import { AgentOutput, AgentOutputEvidence, EpistemicStatus } from './contracts/agent-output';
import { MVP_DOMAINS, MVP_PAIRS, MODEL_IDS, PROMPT_VERSION } from './specialists/specialist-roster';
import { LIFE_MASTER_COMPOSITION_PROMPT } from './specialists/prompts';
import { AuditLogService } from '../audit/audit-log.service';

export interface AskResult {
  output: AgentOutput & {
    sources: string[];
    epistemicStatus: EpistemicStatus;
    evidence: Array<AgentOutputEvidence & { epistemicStatus: EpistemicStatus }>;
  };
  omittedDomains: string[];
  /** docs/05 §8 mechanism 3 — cross-domain disagreement notes, populated
   * directly from DisagreementService.checkCrossDomain rather than left to
   * the composition model's prose to (maybe) restate. See FINDING below. */
  crossDomainDisagreements: string[];
  pendingConfirmation: { tool: 'cancel_scheduled_workout'; sessionId: string } | null;
}

/**
 * docs/03-system-architecture.md §2.4 / docs/05-agent-architecture.md §1-9
 * — the Life Master Agent orchestrator. Runs entirely inside one
 * `runAsUser` transaction (the caller's `client`), matching every other
 * write path in this codebase: one failure anywhere rolls the whole ask
 * back rather than leaving orphaned conversation/output rows.
 */
@Injectable()
export class LifeMasterAgentService {
  constructor(
    @Inject(MODEL_PROVIDER) private readonly model: ModelProvider,
    private readonly toolExecutor: ToolExecutorService,
    private readonly dispatcher: SpecialistDispatcherService,
    private readonly disagreement: DisagreementService,
    private readonly repository: AgentOutputRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  async ask(client: PoolClient, userId: string, scopes: string[], question: string): Promise<AskResult> {
    const { conversationId, userTurnId } = await this.repository.startConversation(client, userId, question);

    // docs/03 §2.4: a cheap/fast model call classifies which domains the
    // question touches, narrowed to what MVP actually dispatches (docs/08
    // §2.2/§2.4 — Productivity is a passive signal only, never a
    // dispatched specialist).
    const classification = await this.model.classifyIntent({ question, availableDomains: MVP_DOMAINS });
    const requestedDomains = classification.domains.filter((d) => MVP_DOMAINS.includes(d));

    const omittedDomains: string[] = [];
    const dispatchDomains = requestedDomains.filter((d) => {
      if (scopes.includes(`${d}.read`)) return true;
      omittedDomains.push(d);
      return false;
    });

    // docs/05 §5: the orchestrator's only tool.
    const snapshotResult = await this.toolExecutor.invoke({
      agentName: 'life_master_agent',
      toolName: 'get_context_snapshot',
      rawArgs: { domains: dispatchDomains.length > 0 ? dispatchDomains : MVP_DOMAINS.slice(0, 1) },
      userId,
      scopes,
      client,
    });
    const snapshot = snapshotResult.status === 'executed' ? snapshotResult.result : null;

    const specialistOutputIds: string[] = [];
    const finalOutputByDomain = new Map<string, AgentOutput>();
    const rawFindingsForComposition: Array<{
      domain: string;
      primary: AgentOutput;
      secondary: AgentOutput;
      disagreementNote: string | null;
    }> = [];
    let actionableSessionId: string | null = null;

    // docs/05 §1: pairs run SEQUENTIALLY, not in parallel — across
    // domains too (this loop, not Promise.all), since each dispatch is
    // itself a real, potentially costly model call and there is no
    // documented requirement for cross-domain concurrency at MVP scale.
    for (const pair of MVP_PAIRS) {
      if (!dispatchDomains.includes(pair.domain)) continue;

      const primaryDispatch = await this.dispatcher.dispatch({
        agentName: pair.primary,
        userId,
        scopes,
        client,
        userPrompt: question,
      });
      const primaryId = await this.repository.persist(client, userId, userTurnId, primaryDispatch.output);
      specialistOutputIds.push(primaryId);

      const secondaryDispatch = await this.dispatcher.dispatch({
        agentName: pair.secondary,
        userId,
        scopes,
        client,
        userPrompt: question,
        primaryOutput: primaryDispatch.output,
      });
      const verdict = await this.disagreement.checkPair(
        primaryDispatch.output,
        secondaryDispatch.output,
        secondaryDispatch.selfDeclaredDisagreement,
      );
      const secondaryOutputToPersist: AgentOutput = verdict.disagrees
        ? { ...secondaryDispatch.output, disagreesWithOutputId: primaryId }
        : secondaryDispatch.output;
      const secondaryId = await this.repository.persist(client, userId, userTurnId, secondaryOutputToPersist);
      specialistOutputIds.push(secondaryId);

      finalOutputByDomain.set(pair.domain, { ...secondaryOutputToPersist });
      rawFindingsForComposition.push({
        domain: pair.domain,
        primary: primaryDispatch.output,
        secondary: secondaryOutputToPersist,
        disagreementNote: verdict.disagrees ? verdict.note ?? 'the two agents in this pair reached different conclusions' : null,
      });

      if (!actionableSessionId) {
        actionableSessionId = primaryDispatch.actionableSessionId ?? secondaryDispatch.actionableSessionId ?? null;
      }
    }

    // docs/05 §8 mechanism 3: cross-domain disagreement, only meaningful
    // once more than one domain was actually dispatched.
    const crossDomainNotes: string[] = [];
    if (finalOutputByDomain.size > 1) {
      const crossResults = await this.disagreement.checkCrossDomain(finalOutputByDomain);
      for (const r of crossResults) {
        // checkCrossDomain already filters to real mismatches internally
        // (disagreement.service.ts) — every entry here is a genuine one.
        const note = r.verdict.note ?? `${r.domainA} and ${r.domainB} findings appear to conflict`;
        crossDomainNotes.push(note);
        // FINDING (pre-Milestone-8 audit, 2026-09-21): this mechanism's
        // result used to be fed only into the composition prompt and then
        // discarded — no durable record existed if the composition model
        // omitted it from its prose (CLAUDE.md: "agent disagreement is
        // surfaced, never silently resolved"). Audited here regardless of
        // what the composed answer ends up saying, and returned as its own
        // structured field below rather than only trusted to prose.
        await this.auditLog.record(client, {
          actorType: 'system',
          actingAsUserId: userId,
          action: 'agent.cross_domain_disagreement_detected',
          result: 'success',
          metadata: { domainA: r.domainA, domainB: r.domainB, note },
        });
      }
    }

    const anyRequiresHumanReview = rawFindingsForComposition.some(
      (f) => f.primary.requiresHumanReview || f.secondary.requiresHumanReview,
    );
    const highestConfirmableTier = rawFindingsForComposition.reduce((max, f) => {
      const t = f.secondary.requiresUserConfirmation ? f.secondary.riskTier : f.primary.requiresUserConfirmation ? f.primary.riskTier : 0;
      return Math.max(max, t);
    }, 0);

    const compositionInput = {
      question,
      snapshot,
      findings: rawFindingsForComposition.map((f) => ({
        domain: f.domain,
        primaryFinding: f.primary.finding,
        primaryRecommendation: f.primary.recommendation,
        secondaryFinding: f.secondary.finding,
        secondaryRecommendation: f.secondary.recommendation,
        disagreementNote: f.disagreementNote,
      })),
      crossDomainDisagreements: crossDomainNotes,
      omittedDomains,
    };

    const composed = await this.model.runSpecialist(
      {
        agentName: 'life_master_agent',
        model: MODEL_IDS.reasoning,
        systemPrompt: LIFE_MASTER_COMPOSITION_PROMPT,
        userPrompt: JSON.stringify(compositionInput),
        tools: [],
      },
      async () => {
        throw new Error('life_master_agent has no tools of its own — docs/03 §2.4');
      },
    );

    const composedOutput: AgentOutput = {
      finding: composed.finding.finding,
      evidence: composed.finding.evidence,
      uncertainty: composed.finding.uncertainty,
      recommendation: composed.finding.recommendation,
      // deterministic, not model-decided (docs/05 §10 — never silently
      // cleared or downgraded by the composition step).
      requiresHumanReview: anyRequiresHumanReview,
      requiresUserConfirmation: highestConfirmableTier > 0,
      agentName: 'life_master_agent',
      modelVersion: composed.modelVersion,
      promptVersion: PROMPT_VERSION,
      dataTimestamp: composed.finding.dataTimestamp,
      toolsUsed: [],
      riskTier: highestConfirmableTier as AgentOutput['riskTier'],
      disagreesWithOutputId: null,
      confidence: composed.finding.confidence,
    };

    const composedId = await this.repository.persist(client, userId, userTurnId, composedOutput);
    await this.repository.recordCompositionSources(client, composedId, specialistOutputIds);
    await this.repository.recordAssistantTurn(client, conversationId, composedOutput.finding, [
      ...new Set(rawFindingsForComposition.flatMap((f) => [...f.primary.toolsUsed, ...f.secondary.toolsUsed])),
    ]);
    await this.repository.endConversation(client, conversationId);

    const sources = await this.repository.resolveSources(client, composedId, composedOutput.evidence);
    const taggedEvidence = await this.repository.attachEvidenceEpistemicStatus(client, composedOutput.evidence);

    return {
      output: {
        ...composedOutput,
        disagreesWithOutputId: null,
        sources,
        epistemicStatus: AgentOutputRepository.epistemicStatusOf(composedOutput),
        evidence: taggedEvidence,
      },
      omittedDomains,
      crossDomainDisagreements: crossDomainNotes,
      pendingConfirmation:
        actionableSessionId && highestConfirmableTier >= 2
          ? { tool: 'cancel_scheduled_workout', sessionId: actionableSessionId }
          : null,
    };
  }
}
