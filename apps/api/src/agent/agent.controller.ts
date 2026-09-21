import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { TenantDatabaseService } from '../database/tenant-database.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ScopeGuard } from '../auth/guards/scope.guard';
import { EntitlementGuard } from '../auth/guards/entitlement.guard';
import { RequiredScope } from '../auth/decorators/required-scope.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestContext } from '../auth/request-context';
import { AuditLogService } from '../audit/audit-log.service';
import { LifeMasterAgentService } from './life-master-agent.service';
import { AgentActionsService } from './agent-actions.service';
import { AgentAskThrottlerGuard } from './agent-ask-throttler.guard';
import { AskDto } from './dto/ask.dto';
import { RequestCancelWorkoutDto } from './dto/request-cancel-workout.dto';
import { ConfirmCancelWorkoutDto } from './dto/confirm-cancel-workout.dto';

/**
 * docs/03-system-architecture.md §4 (the worked example) end to end.
 * `/v1/agent/ask` is the only place `LifeMasterAgentService.ask` runs — it
 * owns the one `runAsUser` transaction the whole orchestration lives
 * inside, matching every other write path in this codebase.
 */
@Controller('v1/agent')
@UseGuards(AuthGuard, ScopeGuard, EntitlementGuard)
export class AgentController {
  constructor(
    private readonly db: TenantDatabaseService,
    private readonly lifeMasterAgent: LifeMasterAgentService,
    private readonly agentActions: AgentActionsService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Post('ask')
  @HttpCode(200)
  @RequiredScope('agent.ask')
  @UseGuards(AgentAskThrottlerGuard)
  async ask(@CurrentUser() ctx: RequestContext, @Body() dto: AskDto) {
    const result = await this.db.runAsUser(ctx.userId, async (client) => {
      const askResult = await this.lifeMasterAgent.ask(client, ctx.userId, ctx.scopes, dto.question);
      await this.auditLog.record(client, {
        actorType: 'user',
        actingAsUserId: ctx.userId,
        action: 'agent.ask',
        resourceType: 'agent_outputs',
        riskTier: askResult.output.riskTier,
        result: 'success',
      });
      return askResult;
    });
    return result;
  }

  /** First step of the confirm flow — mints a confirmation token without
   * executing anything (docs/05 §6 step 6, T7's must-fix). */
  @Post('actions/cancel-workout')
  @HttpCode(200)
  @RequiredScope('fitness.write')
  async requestCancelWorkout(@CurrentUser() ctx: RequestContext, @Body() dto: RequestCancelWorkoutDto) {
    const result = await this.agentActions.requestCancelWorkout(ctx.userId, dto.sessionId);
    return this.toHttpBody(result);
  }

  /** Second step — executes only against a valid, single-use,
   * still-unexpired token bound to this exact user/tool/args. */
  @Post('actions/cancel-workout/confirm')
  @HttpCode(200)
  @RequiredScope('fitness.write')
  async confirmCancelWorkout(@CurrentUser() ctx: RequestContext, @Body() dto: ConfirmCancelWorkoutDto) {
    const result = await this.agentActions.confirmCancelWorkout(ctx.userId, dto.sessionId, dto.confirmationToken);
    return this.toHttpBody(result);
  }

  private toHttpBody(result: Awaited<ReturnType<AgentActionsService['requestCancelWorkout']>>) {
    if (result.status === 'denied') {
      throw new ForbiddenException(result.reason);
    }
    if (result.status === 'invalid') {
      throw new BadRequestException(result.reason);
    }
    if (result.status === 'confirmation_required') {
      return { status: 'confirmation_required', confirmationToken: result.confirmationToken, expiresAt: result.expiresAt };
    }
    if (!(result.result as { cancelled?: boolean })?.cancelled) {
      throw new NotFoundException('no matching planned workout for this user');
    }
    return { status: 'executed', cancelled: true };
  }
}
