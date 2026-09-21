import { Inject, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { MODEL_PROVIDER, ModelProvider, ToolCallHandler } from '../model-provider/model-provider.interface';
import { ToolExecutorService } from '../tools/tool-executor.service';
import { ToolRegistryService } from '../tools/tool-registry.service';
import { AgentOutput } from '../contracts/agent-output';
import { AgentName, PROMPT_VERSION, MODEL_IDS } from './specialist-roster';
import { systemPromptFor } from './prompts';

export interface SpecialistDispatchResult {
  output: AgentOutput;
  selfDeclaredDisagreement: { disagrees: boolean; note?: string } | null;
  /** See model-provider.interface.ts's SpecialistFinding doc comment —
   * an API-response-layer hint, not part of the persisted AgentOutput
   * contract. */
  actionableSessionId: string | null;
}

export interface SpecialistDispatchParams {
  agentName: Exclude<AgentName, 'life_master_agent'>;
  userId: string;
  scopes: string[];
  client: PoolClient;
  userPrompt: string;
  /** Present only for the second agent in a pair (docs/05 §3's input
   * pattern, item 4). */
  primaryOutput?: AgentOutput;
}

/**
 * Runs exactly one specialist invocation to completion (docs/05
 * §3's "output pattern... exactly one AgentOutput per invocation") and
 * maps its raw model output onto the wire contract. Persistence and
 * cross-output disagreement-id resolution are the orchestrator's job, not
 * this service's — a dispatcher call has no idea what id the primary
 * output will be persisted under until the caller does that itself.
 */
@Injectable()
export class SpecialistDispatcherService {
  constructor(
    @Inject(MODEL_PROVIDER) private readonly model: ModelProvider,
    private readonly toolExecutor: ToolExecutorService,
    private readonly toolRegistry: ToolRegistryService,
  ) {}

  async dispatch(params: SpecialistDispatchParams): Promise<SpecialistDispatchResult> {
    // docs/05 §1's static per-agent ceiling, minus write tools — a
    // specialist's own reasoning pass never itself executes a Tier 2+
    // action; that only ever happens through the separate, explicitly
    // user-confirmed flow (docs/03 §2.7, §9.4 — "producing a
    // recommendation is Tier 0 regardless of what a follow-up action
    // would cost"). Exposing a write tool to the model mid-reasoning
    // would let it mint its own confirmation_required response without
    // any human having asked for one yet.
    const ceiling = this.toolRegistry
      .all()
      .filter((t) => t.callableBy.includes(params.agentName) && t.dataClass !== 'write');

    const onToolCall: ToolCallHandler = async (call) => {
      try {
        const result = await this.toolExecutor.invoke({
          agentName: params.agentName,
          toolName: call.name,
          rawArgs: call.input,
          userId: params.userId,
          scopes: params.scopes,
          client: params.client,
        });
        if (result.status === 'executed') {
          return { toolCallId: call.id, content: JSON.stringify(result.result), isError: false };
        }
        return { toolCallId: call.id, content: `tool did not execute (${result.status})`, isError: true };
      } catch (err) {
        return { toolCallId: call.id, content: `error: ${(err as Error).message}`, isError: true };
      }
    };

    const userPrompt = params.primaryOutput
      ? `${params.userPrompt}\n\nPrimary agent's finding to verify/compare against:\n${JSON.stringify({
          finding: params.primaryOutput.finding,
          recommendation: params.primaryOutput.recommendation,
          confidence: params.primaryOutput.confidence,
          requiresHumanReview: params.primaryOutput.requiresHumanReview,
          riskTier: params.primaryOutput.riskTier,
        })}`
      : params.userPrompt;

    const result = await this.model.runSpecialist(
      {
        agentName: params.agentName,
        model: MODEL_IDS.reasoning,
        systemPrompt: systemPromptFor(params.agentName),
        userPrompt,
        tools: ceiling.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      },
      onToolCall,
    );

    const f = result.finding;
    const output: AgentOutput = {
      finding: f.finding,
      evidence: f.evidence.map((e) => ({ coreObjectId: e.coreObjectId, description: e.description })),
      uncertainty: f.uncertainty,
      recommendation: f.recommendation,
      requiresHumanReview: f.requiresHumanReview,
      requiresUserConfirmation: f.requiresUserConfirmation,
      agentName: params.agentName,
      modelVersion: result.modelVersion,
      promptVersion: PROMPT_VERSION,
      dataTimestamp: f.dataTimestamp,
      toolsUsed: result.toolsUsed,
      riskTier: f.riskTier,
      disagreesWithOutputId: null,
      confidence: f.confidence,
    };

    return {
      output,
      selfDeclaredDisagreement: f.disagreesWithPrimary ?? null,
      actionableSessionId: f.actionableSessionId ?? null,
    };
  }
}
