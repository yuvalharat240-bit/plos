import { Injectable, OnModuleInit } from '@nestjs/common';
import { TenantDatabaseService } from '../../database/tenant-database.service';
import { ScopedToolContract } from '../contracts/scoped-tool';
import { COMMON_TOOLS } from './common-tools';
import { HEALTH_TOOLS } from './health-tools';
import { FITNESS_TOOLS } from './fitness-tools';
import { MENTAL_HEALTH_TOOLS } from './mental-health-tools';
import { getContextSnapshot } from './context-snapshot-tool';
import { MVP_DOMAINS } from '../specialists/specialist-roster';

/**
 * docs/05-agent-architecture.md §6 step 5 / docs/06-threat-model.md T4's
 * must-fix: "a tool's riskTier must be <= its scope's catalog risk_tier,
 * asserted once at tool-registry startup, not per-call... a build-time
 * guarantee." Tools whose `requiredScope` is '' (the common tools, whose
 * real scope is resolved per-domain at call time by ToolExecutorService)
 * are asserted against every domain's own read scope instead of a single
 * catalog row, since that's the actual ceiling they operate under.
 */
@Injectable()
export class ToolRegistryService implements OnModuleInit {
  private readonly tools = new Map<string, ScopedToolContract<any, any>>();

  constructor(private readonly db: TenantDatabaseService) {}

  async onModuleInit(): Promise<void> {
    const allTools: ScopedToolContract<any, any>[] = [
      ...COMMON_TOOLS,
      ...HEALTH_TOOLS,
      ...FITNESS_TOOLS,
      ...MENTAL_HEALTH_TOOLS,
      getContextSnapshot,
    ];
    for (const tool of allTools) {
      if (this.tools.has(tool.name)) {
        throw new Error(`duplicate tool registration: ${tool.name}`);
      }
      this.tools.set(tool.name, tool);
    }

    await this.assertTierConsistency();
    this.assertTier2PlusRequiresConfirmation();
  }

  get(name: string): ScopedToolContract<any, any> | undefined {
    return this.tools.get(name);
  }

  all(): ScopedToolContract<any, any>[] {
    return Array.from(this.tools.values());
  }

  private async assertTierConsistency(): Promise<void> {
    const catalog = await this.db.runPreAuth((client) =>
      client
        .query(`SELECT scope, risk_tier FROM permission_scopes`)
        .then((r) => new Map(r.rows.map((row) => [row.scope as string, row.risk_tier as number]))),
    );

    const domainReadScope = (domain: string) => `${domain}.read`;

    for (const tool of this.tools.values()) {
      // FINDING (security review, docs/09 Milestone 7): this used to be
      // a hand-typed literal duplicating MVP_DOMAINS/AGENT_DOMAIN — the
      // exact set of domains this build-time assertion is supposed to
      // cover would silently stop growing with the real roster if
      // someone added a domain there and forgot this copy.
      const scopesToCheck = tool.requiredScope ? [tool.requiredScope] : MVP_DOMAINS.map(domainReadScope);

      for (const scope of scopesToCheck) {
        const scopeTier = catalog.get(scope);
        if (scopeTier === undefined) {
          throw new Error(
            `tool registry startup check failed: tool "${tool.name}" declares requiredScope "${scope}" which is not in the permission_scopes catalog`,
          );
        }
        if (tool.riskTier > scopeTier) {
          throw new Error(
            `tool registry startup check failed: tool "${tool.name}" has riskTier ${tool.riskTier} > its scope "${scope}"'s catalog risk_tier ${scopeTier}`,
          );
        }
      }
    }
  }

  /**
   * FINDING (pre-Milestone-8 audit, 2026-09-21): `riskTier` and
   * `requiresConfirmation` are declared independently on every
   * ScopedToolContract, and ToolExecutorService.invoke() branches only on
   * `requiresConfirmation(args)` — `riskTier` is read for audit-logging
   * only, never cross-checked. Nothing previously caught a tool author
   * who registers a tier 2+ tool (docs/09's own "AI never autonomously
   * executes Tier 3/4 actions" non-negotiable) with a `requiresConfirmation`
   * that returns false. Every real tool's `requiresConfirmation` today is a
   * constant closure ignoring its args entirely (`() => true`/`() => false`
   * — none branch conditionally), so calling it once with an empty args
   * object at startup is safe and exercises the real returned value.
   */
  private assertTier2PlusRequiresConfirmation(): void {
    for (const tool of this.tools.values()) {
      if (tool.riskTier >= 2 && !tool.requiresConfirmation({} as never)) {
        throw new Error(
          `tool registry startup check failed: tool "${tool.name}" has riskTier ${tool.riskTier} (>= 2) but requiresConfirmation() does not return true — a tier 2+ tool must never be autonomously executable`,
        );
      }
    }
  }
}
