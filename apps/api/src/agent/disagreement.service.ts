import { Inject, Injectable } from '@nestjs/common';
import { MODEL_PROVIDER, ModelProvider } from './model-provider/model-provider.interface';
import { AgentOutput } from './contracts/agent-output';

export interface DisagreementVerdict {
  disagrees: boolean;
  orchestratorDetected: boolean;
  note: string | null;
}

function reduce(o: AgentOutput) {
  return { finding: o.finding, recommendation: o.recommendation, requiresHumanReview: o.requiresHumanReview, riskTier: o.riskTier };
}

/**
 * docs/05-agent-architecture.md §8 — two mechanisms within a pair (self-
 * declared, then an independent orchestrator backstop), plus a third,
 * cross-pair mechanism when more than one domain was dispatched.
 */
@Injectable()
export class DisagreementService {
  constructor(@Inject(MODEL_PROVIDER) private readonly model: ModelProvider) {}

  /** Mechanisms 1 and 2, within one pair. Self-declaration is checked
   * first — if the secondary agent already flagged it, the backstop call
   * is skipped (nothing left to catch), but the backstop still runs
   * whenever self-declaration did NOT flag anything, since its whole
   * point is to catch what self-declaration misses. */
  async checkPair(
    primary: AgentOutput,
    secondary: AgentOutput,
    selfDeclared: { disagrees: boolean; note?: string } | null,
  ): Promise<DisagreementVerdict> {
    if (selfDeclared?.disagrees) {
      return { disagrees: true, orchestratorDetected: false, note: selfDeclared.note ?? null };
    }
    const backstop = await this.model.detectDisagreement({ primary: reduce(primary), secondary: reduce(secondary) });
    if (backstop.mismatch) {
      return { disagrees: true, orchestratorDetected: true, note: backstop.note };
    }
    return { disagrees: false, orchestratorDetected: false, note: null };
  }

  /** Mechanism 3 (§8 point 3): pairwise across every dispatched domain's
   * own final (secondary-agent) reading. docs/05 describes this as "the
   * same backstop model call... extended to compare... across all
   * dispatched outputs," which for MVP's bounded 3-domain ceiling is the
   * same comparison set as running the pairwise backstop once per domain
   * pair (at most 3 calls for 3 domains) — a documented simplification of
   * "one extended call" into "the same coverage via pairwise calls,"
   * not a narrower check. */
  async checkCrossDomain(finalOutputsByDomain: Map<string, AgentOutput>): Promise<
    Array<{ domainA: string; domainB: string; verdict: DisagreementVerdict }>
  > {
    const domains = Array.from(finalOutputsByDomain.keys());
    const results: Array<{ domainA: string; domainB: string; verdict: DisagreementVerdict }> = [];
    for (let i = 0; i < domains.length; i++) {
      for (let j = i + 1; j < domains.length; j++) {
        const a = finalOutputsByDomain.get(domains[i])!;
        const b = finalOutputsByDomain.get(domains[j])!;
        const backstop = await this.model.detectDisagreement({ primary: reduce(a), secondary: reduce(b) });
        if (backstop.mismatch) {
          results.push({
            domainA: domains[i],
            domainB: domains[j],
            verdict: { disagrees: true, orchestratorDetected: true, note: backstop.note },
          });
        }
      }
    }
    return results;
  }
}
