import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  ClassifyIntentInput,
  ClassifyIntentResult,
  DisagreementCheckInput,
  DisagreementCheckResult,
  ModelProvider,
  RunSpecialistInput,
  RunSpecialistResult,
  ToolCallHandler,
} from './model-provider.interface';
import { MODEL_IDS } from '../specialists/specialist-roster';

/**
 * ADR D3 (docs/02-architecture-decision-record.md) names the concrete
 * implementation "the Claude Agent SDK." **Documented deviation, found
 * while actually building this milestone, not assumed away**: the
 * published npm package under that literal name
 * (`@anthropic-ai/claude-agent-sdk`) is the Claude Code CLI agent harness
 * repackaged as a library — session stores, git worktrees, hooks,
 * teammate/observer machinery, and a hard dependency on spawning the
 * `claude` CLI binary as a subprocess with its own settings cascade and
 * managed-policy resolution. That is the right tool for building a coding
 * assistant; it is a poor fit for a stateless, multi-tenant NestJS
 * backend handling one `/v1/agent/ask` HTTP request at a time with no
 * interactive login, no project directory, and no reason to touch a
 * filesystem worktree at all.
 *
 * What ADR D3 actually asks for — "tool-calling loop, context management,
 * retry/error handling... without hand-rolling" plus "each specialist its
 * own system prompt, model choice, and tool allow-list" (docs/05 §1) — is
 * fully satisfied by the plain Anthropic Messages API
 * (`@anthropic-ai/sdk`, the standard TypeScript client for the Messages
 * endpoint) with a small, explicit tool-use loop below. This is the
 * ONLY file in the codebase that imports either Anthropic package,
 * preserving ADR D3's actual containment goal ("only that one
 * implementation file should ever import the SDK") even though the
 * specific package changed. Recorded here, and in docs/10-progress-checklist.md,
 * as a real Phase 1 finding worth folding back into ADR D3 — not silently
 * substituted.
 *
 * Requires `ANTHROPIC_API_KEY` in the environment. No dev fallback is
 * baked in here (unlike TokenService's internal HMAC secret) — a fake key
 * would only produce a confusing auth failure against the real API rather
 * than a safe local default, so this fails fast and clearly instead.
 */
const SUBMIT_FINDING_TOOL = {
  name: 'submit_finding',
  description:
    'Call this exactly once, as your final action, to submit your finding. Do not call it until you have gathered whatever context you need from the other available tools.',
  input_schema: {
    type: 'object' as const,
    required: ['finding', 'evidence', 'confidence', 'uncertainty', 'requiresHumanReview', 'requiresUserConfirmation', 'riskTier', 'dataTimestamp'],
    properties: {
      finding: { type: 'string' },
      evidence: {
        type: 'array',
        items: {
          type: 'object',
          required: ['coreObjectId', 'description'],
          properties: { coreObjectId: { type: 'string' }, description: { type: 'string' } },
        },
      },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      uncertainty: { type: 'array', items: { type: 'string' } },
      recommendation: { type: ['string', 'null'] },
      requiresHumanReview: { type: 'boolean' },
      requiresUserConfirmation: { type: 'boolean' },
      riskTier: { type: 'integer', minimum: 0, maximum: 4 },
      dataTimestamp: { type: 'string' },
      disagreesWithPrimary: {
        type: 'object',
        properties: { disagrees: { type: 'boolean' }, note: { type: 'string' } },
      },
      actionableSessionId: {
        type: 'string',
        description:
          'Only set this (fitness_performance only) when your recommendation concretely implies cancelling one specific planned workout session — the id of that session.',
      },
    },
  },
};

const CLASSIFY_DOMAINS_TOOL = (availableDomains: string[]) => ({
  name: 'classify_domains',
  description: 'Report which domains this question touches.',
  input_schema: {
    type: 'object' as const,
    required: ['domains'],
    properties: { domains: { type: 'array', items: { type: 'string', enum: availableDomains } } },
  },
});

const REPORT_DISAGREEMENT_TOOL = {
  name: 'report_disagreement',
  description: 'Report whether the two findings materially disagree.',
  input_schema: {
    type: 'object' as const,
    required: ['mismatch'],
    properties: { mismatch: { type: 'boolean' }, note: { type: 'string' } },
  },
};

const MAX_TURNS_DEFAULT = 8;
const MAX_TOKENS = 4096;

@Injectable()
export class AnthropicModelProviderService implements ModelProvider {
  private readonly client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  async classifyIntent(input: ClassifyIntentInput): Promise<ClassifyIntentResult> {
    const response = await this.client.messages.create({
      model: MODEL_IDS.cheap,
      max_tokens: 512,
      system:
        'You classify which life domains a question touches, from a fixed list. Pick the minimum set genuinely relevant — do not over-include.',
      messages: [{ role: 'user', content: input.question }],
      tools: [CLASSIFY_DOMAINS_TOOL(input.availableDomains)],
      tool_choice: { type: 'tool', name: 'classify_domains' },
    });
    const call = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    const domains = (call?.input as { domains?: string[] })?.domains ?? [];
    return { domains: domains.filter((d) => input.availableDomains.includes(d)), modelVersion: response.model };
  }

  async runSpecialist(input: RunSpecialistInput, onToolCall: ToolCallHandler): Promise<RunSpecialistResult> {
    const tools = [...input.tools.map(toAnthropicTool), SUBMIT_FINDING_TOOL];
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: input.userPrompt }];
    const toolsUsed: string[] = [];
    const maxTurns = input.maxTurns ?? MAX_TURNS_DEFAULT;
    let modelVersion = input.model;

    for (let turn = 0; turn < maxTurns; turn++) {
      const forcingFinish = turn === maxTurns - 1;
      const response = await this.client.messages.create({
        model: input.model,
        max_tokens: MAX_TOKENS,
        system: input.systemPrompt,
        messages,
        tools,
        tool_choice: forcingFinish ? { type: 'tool', name: 'submit_finding' } : { type: 'auto' },
      });
      modelVersion = response.model;

      const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      const submission = toolUseBlocks.find((b) => b.name === 'submit_finding');
      if (submission) {
        return { finding: submission.input as RunSpecialistResult['finding'], toolsUsed, modelVersion };
      }

      if (toolUseBlocks.length === 0) {
        throw new Error(`${input.agentName} finished without calling submit_finding (stop_reason: ${response.stop_reason})`);
      }

      messages.push({ role: 'assistant', content: response.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        toolsUsed.push(block.name);
        const result = await onToolCall({ id: block.id, name: block.name, input: block.input as Record<string, unknown> });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: result.toolCallId,
          content: result.content,
          is_error: result.isError,
        });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    throw new Error(`${input.agentName} did not submit a finding within ${maxTurns} turns`);
  }

  async detectDisagreement(input: DisagreementCheckInput): Promise<DisagreementCheckResult> {
    const response = await this.client.messages.create({
      model: MODEL_IDS.cheap,
      max_tokens: 512,
      system:
        'You are the disagreement backstop (docs/05-agent-architecture.md §8, mechanism 2). Compare two structured findings for a mismatch a self-declaration might have missed: a requires_human_review mismatch, a risk_tier delta, or a recommendation the second finding contradicts without saying so.',
      messages: [
        {
          role: 'user',
          content: JSON.stringify({ primary: input.primary, secondary: input.secondary }),
        },
      ],
      tools: [REPORT_DISAGREEMENT_TOOL],
      tool_choice: { type: 'tool', name: 'report_disagreement' },
    });
    const call = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    const parsed = call?.input as { mismatch?: boolean; note?: string };
    return { mismatch: parsed?.mismatch ?? false, note: parsed?.note ?? null, modelVersion: response.model };
  }

  async embedding(): Promise<number[]> {
    throw new Error(
      'ModelProvider.embedding() is not implemented at MVP — docs/08-mvp-definition.md §9.1 defers embeddings entirely; no MVP code path should ever call this.',
    );
  }
}

function toAnthropicTool(t: { name: string; description: string; inputSchema: Record<string, unknown> }) {
  return { name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema };
}
