import { Injectable } from '@nestjs/common';
import { TenantDatabaseService } from '../database/tenant-database.service';
import { ToolExecutorService, ToolInvokeResult } from './tools/tool-executor.service';
import { readGrantedScopes } from '../auth/read-granted-scopes';

/**
 * The direct, non-conversational path to a Tier 2+ Scoped Tool — docs/09
 * Milestone 5's "wire HomeView's InsightCard actions... to the real Tier 2
 * confirm flow for cancel_scheduled_workout." Once the Life Master Agent
 * has surfaced a recommendation that implies cancelling a specific
 * session (LifeMasterAgentService.ask's `pendingConfirmation`), the actual
 * confirm/execute round trip does not re-invoke the model — it goes
 * straight through the same ToolExecutorService chain, attributed to
 * `fitness_performance` (docs/05 §3.4: that's the tool's registered
 * ceiling owner) even though no live model call happens at confirm time.
 */
@Injectable()
export class AgentActionsService {
  constructor(
    private readonly db: TenantDatabaseService,
    private readonly toolExecutor: ToolExecutorService,
  ) {}

  async requestCancelWorkout(userId: string, sessionId: string): Promise<ToolInvokeResult> {
    return this.cancelWorkout(userId, sessionId);
  }

  async confirmCancelWorkout(userId: string, sessionId: string, confirmationToken: string): Promise<ToolInvokeResult> {
    return this.cancelWorkout(userId, sessionId, confirmationToken);
  }

  private async cancelWorkout(userId: string, sessionId: string, confirmationToken?: string): Promise<ToolInvokeResult> {
    return this.db.runAsUser(userId, async (client) => {
      const scopes = await readGrantedScopes(client, userId);
      return this.toolExecutor.invoke({
        agentName: 'fitness_performance',
        toolName: 'cancel_scheduled_workout',
        rawArgs: { sessionId },
        userId,
        scopes,
        client,
        confirmationToken,
      });
    });
  }
}
