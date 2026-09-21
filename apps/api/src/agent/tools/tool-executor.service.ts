import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AuditLogService } from '../../audit/audit-log.service';
import { TenantDatabaseService } from '../../database/tenant-database.service';
import { AgentName, domainOf } from '../specialists/specialist-roster';
import { ToolRegistryService } from './tool-registry.service';
import { ConfirmationTokenService } from './confirmation-token.service';

/**
 * docs/05-agent-architecture.md §6 — "the chain every call runs, in
 * order": Agent -> Scoped tool -> Authorization -> Validation ->
 * Risk-tier check (build-time, ToolRegistryService.onModuleInit) ->
 * Confirmation if required -> Execution -> Audit, always, including
 * denials (docs/03 §7, docs/04 §11).
 *
 * FINDING (security review, docs/09 Milestone 7): every denial/error
 * branch below writes its audit row on `params.client` — the CALLER's
 * own `runAsUser` transaction — then used to `throw`. A caller with no
 * try/catch around `invoke()` (`AgentActionsService`,
 * `LifeMasterAgentService.ask`'s own `get_context_snapshot` call) has
 * that throw propagate straight into `TenantDatabaseService.runAsUser`'s
 * `catch { ROLLBACK }`, which silently erases the very audit row just
 * written — the exact opposite of "always, including denials." Fixed at
 * the root: ceiling/scope/validation denials no longer throw at all —
 * they return a result the caller inspects, so the transaction commits
 * normally and the audit row survives. A genuine execution *fault*
 * (`tool.execute()` itself throwing — a real bug or transient DB error,
 * not a policy denial) still rethrows, since rolling back whatever it
 * partially wrote is correct — but its audit row is now written on a
 * SEPARATE, independent transaction first, so it survives regardless of
 * what happens to the transaction that's about to roll back.
 */
export type ToolInvokeResult =
  | { status: 'executed'; result: unknown }
  | { status: 'confirmation_required'; confirmationToken: string; expiresAt: Date }
  | { status: 'denied'; reason: string }
  | { status: 'invalid'; reason: string };

export interface ToolInvokeParams {
  agentName: AgentName;
  toolName: string;
  rawArgs: unknown;
  userId: string;
  scopes: string[];
  client: PoolClient;
  modelVersion?: string;
  confirmationToken?: string;
}

@Injectable()
export class ToolExecutorService {
  constructor(
    private readonly registry: ToolRegistryService,
    private readonly auditLog: AuditLogService,
    private readonly confirmationTokens: ConfirmationTokenService,
    private readonly db: TenantDatabaseService,
  ) {}

  async invoke(params: ToolInvokeParams): Promise<ToolInvokeResult> {
    const tool = this.registry.get(params.toolName);
    if (!tool) {
      // Not a policy denial — a registered-tool-name mismatch is a
      // programming error (the SDK-level allow-list is supposed to make
      // this unreachable). Audited on its own transaction, same reason
      // as an execution fault below: there is no caller-supplied
      // `tool.riskTier` to hang an audit row off via the normal path, and
      // this must survive even if whatever called `invoke()` rolls back.
      await this.auditOnOwnTransaction(params.userId, {
        actorType: 'agent',
        actingAsUserId: params.userId,
        action: `tool.${params.toolName}`,
        resourceType: 'agent_tool',
        result: 'error',
        metadata: { agentName: params.agentName, reason: 'unknown tool name' },
      });
      throw new NotFoundException(`unknown tool: ${params.toolName}`);
    }

    const requiredScope = tool.requiredScope || this.commonToolScope(params.agentName);

    // Step: Authorization — static per-agent ceiling AND the caller's
    // actually-granted scope, independent of the SDK-level allow-list
    // that already bounded which tools the model could even attempt
    // (docs/05 §1, §6 step 1-3). Returns rather than throws — see this
    // file's header finding — so the audit row below commits with the
    // rest of the caller's transaction instead of being rolled back by
    // an uncaught throw.
    if (!tool.callableBy.includes(params.agentName)) {
      await this.audit(params, tool.riskTier, 'denied', undefined, {
        reason: 'agent not in tool ceiling',
      });
      return { status: 'denied', reason: `${params.agentName} is not permitted to call ${tool.name}` };
    }
    if (!params.scopes.includes(requiredScope)) {
      await this.audit(params, tool.riskTier, 'denied', undefined, {
        reason: 'missing required scope',
        requiredScope,
      });
      return { status: 'denied', reason: `missing required scope: ${requiredScope}` };
    }

    // Step: Validation — schema-checked, independent of the model's own
    // "type system" (docs/05 §6 step 4). A bad argument is the caller's
    // mistake, not a system fault — returned, not thrown, same reasoning
    // as the authorization step above.
    let args: unknown;
    try {
      args = tool.validate(params.rawArgs);
    } catch (err) {
      await this.audit(params, tool.riskTier, 'denied', undefined, {
        reason: 'validation failed',
        message: (err as Error).message,
      });
      return { status: 'invalid', reason: (err as Error).message };
    }
    const argsHash = ConfirmationTokenService.hashArgs(args);

    // Step: Confirmation if required (docs/05 §6 step 6, T7's must-fix).
    if (tool.requiresConfirmation(args)) {
      if (!params.confirmationToken) {
        const { token, expiresAt } = await this.confirmationTokens.issue(params.client, {
          userId: params.userId,
          toolName: tool.name,
          argsHash,
        });
        await this.audit(params, tool.riskTier, 'success', argsHash, {
          outcome: 'confirmation_required',
        });
        return { status: 'confirmation_required', confirmationToken: token, expiresAt };
      }

      const valid = await this.confirmationTokens.verifyAndConsume(params.client, params.confirmationToken, {
        userId: params.userId,
        toolName: tool.name,
        argsHash,
      });
      if (!valid) {
        await this.audit(params, tool.riskTier, 'denied', argsHash, {
          reason: 'invalid, expired, or already-used confirmation token',
        });
        return { status: 'denied', reason: 'invalid or expired confirmation' };
      }
    }

    // Step: Execution — a parameterized, user_id-scoped call against the
    // caller's already-`runAsUser`-scoped connection (docs/04 §10.1). A
    // thrown error here is a genuine, unexpected fault (not a policy
    // denial) — rethrown so the caller's transaction rolls back whatever
    // it partially wrote, which is correct. The audit row is written on
    // a SEPARATE transaction first specifically so it survives that
    // rollback — the one case in this method where `params.client`
    // itself cannot be trusted to still commit.
    try {
      const result = await tool.execute(
        { userId: params.userId, agentName: params.agentName, client: params.client, scopes: params.scopes },
        args,
      );
      await this.audit(params, tool.riskTier, 'success', argsHash);
      return { status: 'executed', result };
    } catch (err) {
      await this.auditOnOwnTransaction(params.userId, {
        actorType: 'agent',
        actingAsUserId: params.userId,
        action: `tool.${params.toolName}`,
        resourceType: 'agent_tool',
        riskTier: tool.riskTier,
        result: 'error',
        argsHash,
        metadata: { agentName: params.agentName, message: (err as Error).message },
      });
      throw err;
    }
  }

  /** Writes one audit row on a fresh, independent `runAsUser` transaction
   * — used only for the two outcomes above that must survive even though
   * the caller's own transaction is about to roll back. */
  private async auditOnOwnTransaction(
    userId: string,
    entry: Parameters<AuditLogService['record']>[1],
  ): Promise<void> {
    await this.db.runAsUser(userId, (client) => this.auditLog.record(client, entry));
  }

  private commonToolScope(agentName: AgentName): string {
    return `${domainOf(agentName)}.read`;
  }

  private async audit(
    params: ToolInvokeParams,
    riskTier: number,
    result: 'success' | 'denied' | 'error',
    argsHash?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.auditLog.record(params.client, {
      actorType: 'agent',
      actingAsUserId: params.userId,
      action: `tool.${params.toolName}`,
      resourceType: 'agent_tool',
      riskTier,
      result,
      argsHash,
      modelVersion: params.modelVersion,
      metadata: { agentName: params.agentName, ...metadata },
    });
  }
}
