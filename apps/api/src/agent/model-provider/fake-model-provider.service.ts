import { Injectable } from '@nestjs/common';
import {
  ClassifyIntentInput,
  ClassifyIntentResult,
  DisagreementCheckInput,
  DisagreementCheckResult,
  ModelProvider,
  RunSpecialistInput,
  RunSpecialistResult,
  SpecialistFinding,
  ToolCallHandler,
} from './model-provider.interface';

export interface ScriptedSpecialistRun {
  /** Tool calls this scripted run makes before submitting — routed
   * through the SAME `onToolCall` handler the real Anthropic provider
   * would use, so scripting a run still exercises the real tool-executor
   * chain, real RLS-scoped queries, and real audit logging. Only the
   * model's own reasoning is faked, not the rest of the system. */
  toolCalls?: Array<{ name: string; input: Record<string, unknown> }>;
  finding: SpecialistFinding;
}

/**
 * Deterministic ModelProvider test double. This is NOT a workaround for
 * something untestable — it's the concrete instance of the swappability
 * ADR D3's ModelProvider abstraction exists to provide, standing in for
 * the one dependency in this milestone that is genuinely external, paid,
 * and non-deterministic (a live Anthropic API call). Every other part of
 * the orchestrator (tool chain, RLS, confirmation tokens, disagreement
 * detection, persistence, audit) is exercised for real against real
 * Postgres when this is wired in — see test/agent.e2e-spec.ts.
 */
@Injectable()
export class FakeModelProviderService implements ModelProvider {
  private classifyQueue: ClassifyIntentResult[] = [];
  private specialistQueues = new Map<string, ScriptedSpecialistRun[]>();
  private disagreementQueue: DisagreementCheckResult[] = [];

  reset(): void {
    this.classifyQueue = [];
    this.specialistQueues.clear();
    this.disagreementQueue = [];
  }

  queueClassifyIntent(result: ClassifyIntentResult): void {
    this.classifyQueue.push(result);
  }

  queueSpecialistRun(agentName: string, run: ScriptedSpecialistRun): void {
    const queue = this.specialistQueues.get(agentName) ?? [];
    queue.push(run);
    this.specialistQueues.set(agentName, queue);
  }

  queueDisagreement(result: DisagreementCheckResult): void {
    this.disagreementQueue.push(result);
  }

  async classifyIntent(_input: ClassifyIntentInput): Promise<ClassifyIntentResult> {
    const next = this.classifyQueue.shift();
    if (!next) {
      throw new Error('FakeModelProviderService.classifyIntent called with an empty queue');
    }
    return next;
  }

  async runSpecialist(input: RunSpecialistInput, onToolCall: ToolCallHandler): Promise<RunSpecialistResult> {
    const queue = this.specialistQueues.get(input.agentName);
    const next = queue?.shift();
    if (!next) {
      throw new Error(`FakeModelProviderService.runSpecialist called for "${input.agentName}" with an empty queue`);
    }

    const toolsUsed: string[] = [];
    for (const call of next.toolCalls ?? []) {
      toolsUsed.push(call.name);
      const result = await onToolCall({ id: `fake-${call.name}`, name: call.name, input: call.input });
      if (result.isError) {
        throw new Error(`scripted tool call ${call.name} for ${input.agentName} returned an error: ${result.content}`);
      }
    }

    return { finding: next.finding, toolsUsed, modelVersion: 'fake-model-v1' };
  }

  async detectDisagreement(_input: DisagreementCheckInput): Promise<DisagreementCheckResult> {
    return this.disagreementQueue.shift() ?? { mismatch: false, note: null, modelVersion: 'fake-model-v1' };
  }

  async embedding(): Promise<number[]> {
    throw new Error('FakeModelProviderService.embedding() should never be called — docs/08 §9.1 defers embeddings at MVP.');
  }
}
