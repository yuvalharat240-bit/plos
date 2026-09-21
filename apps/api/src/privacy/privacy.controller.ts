import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { PoolClient } from 'pg';
import { TenantDatabaseService } from '../database/tenant-database.service';
import { AuditLogService } from '../audit/audit-log.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ScopeGuard } from '../auth/guards/scope.guard';
import { EntitlementGuard } from '../auth/guards/entitlement.guard';
import { RequiredScope } from '../auth/decorators/required-scope.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestContext } from '../auth/request-context';
import { ConsentService } from './consent.service';
import { PermissionGrantsService } from './permission-grants.service';
import { ExportBundleService } from './export-bundle.service';
import { AccountDeletionService } from './account-deletion.service';
import { ConfirmationTokenService } from '../agent/tools/confirmation-token.service';
import { ConsentActionDto } from './dto/consent-action.dto';
import { RevokeGrantDto } from './dto/revoke-grant.dto';
import { RequestExportDto } from './dto/request-export.dto';
import { RequestDeletionDto } from './dto/request-deletion.dto';

const EXPORT_MENTAL_HEALTH_TOOL = 'export_mental_health_section';

/**
 * docs/07-privacy-model.md, docs/09 Milestone 6. The Privacy & Data
 * Control Center's real backend — consent, permission grants, data
 * export, and account deletion, all as plain CRUD-shaped endpoints (the
 * same category as journal/workouts/medications, not the agent's Scoped
 * Tool registry, since none of this is model-driven).
 */
@Controller('v1/privacy')
@UseGuards(AuthGuard, ScopeGuard, EntitlementGuard)
export class PrivacyController {
  constructor(
    private readonly db: TenantDatabaseService,
    private readonly consent: ConsentService,
    private readonly grants: PermissionGrantsService,
    private readonly exportBundle: ExportBundleService,
    private readonly accountDeletion: AccountDeletionService,
    private readonly confirmationTokens: ConfirmationTokenService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get('consents')
  @RequiredScope('consent.manage')
  async listConsents(@CurrentUser() ctx: RequestContext) {
    return this.consent.list(ctx.userId);
  }

  @Post('consents/grant')
  @HttpCode(200)
  @RequiredScope('consent.manage')
  async grantConsent(@CurrentUser() ctx: RequestContext, @Body() dto: ConsentActionDto) {
    await this.consent.grant(ctx.userId, dto.consentType);
    return { granted: true };
  }

  @Post('consents/revoke')
  @HttpCode(200)
  @RequiredScope('consent.manage')
  async revokeConsent(@CurrentUser() ctx: RequestContext, @Body() dto: ConsentActionDto) {
    return this.consent.revoke(ctx.userId, dto.consentType);
  }

  @Get('grants')
  @RequiredScope('consent.manage')
  async listGrants(@CurrentUser() ctx: RequestContext) {
    return this.grants.list(ctx.userId);
  }

  @Post('grants/revoke')
  @HttpCode(200)
  @RequiredScope('consent.manage')
  async revokeGrant(@CurrentUser() ctx: RequestContext, @Body() dto: RevokeGrantDto) {
    await this.grants.revoke(ctx.userId, dto.scope);
    return { revoked: true };
  }

  /**
   * docs/07 §8's note: including `mental_health/` requires a step beyond
   * the export job's normal auth. What ships here is a genuine two-step
   * confirm (request -> confirm, reusing the same single-use, time-boxed
   * token machinery Milestone 5 built for Tier 2+ tool confirmation) —
   * a real extra proof-of-intent step, but NOT the fresh Apple/passkey
   * credential re-assertion docs/07 literally describes. That stronger
   * form of reauthentication is a real, flagged gap, not silently
   * substituted for.
   */
  @Post('export')
  @HttpCode(200)
  @RequiredScope('account.export')
  async requestExport(@CurrentUser() ctx: RequestContext, @Body() dto: RequestExportDto) {
    if (!dto.includeMentalHealth) {
      return this.exportBundle.build(ctx.userId, false);
    }

    const argsHash = ConfirmationTokenService.hashArgs({ includeMentalHealth: true });
    if (!dto.confirmationToken) {
      return this.db.runAsUser(ctx.userId, async (client: PoolClient) => {
        const { token, expiresAt } = await this.confirmationTokens.issue(client, {
          userId: ctx.userId,
          toolName: EXPORT_MENTAL_HEALTH_TOOL,
          argsHash,
        });
        // FINDING (pre-Milestone-8 audit, 2026-09-21): this branch issues
        // a confirmation token gating access to mental-health data but
        // never recorded that the request happened — the only trace of a
        // mental-health export attempt was the *outcome*, not the
        // request itself. Every other branch in this controller's own
        // codebase audits the request, not just the result (see
        // AccountDeletionService).
        await this.auditLog.record(client, {
          actorType: 'user',
          actingAsUserId: ctx.userId,
          action: 'privacy.export.mental_health_confirmation_requested',
          resourceType: 'confirmation_tokens',
          result: 'success',
        });
        return { status: 'confirmation_required', confirmationToken: token, expiresAt };
      });
    }

    const valid = await this.db.runAsUser(ctx.userId, (client) =>
      this.confirmationTokens.verifyAndConsume(client, dto.confirmationToken!, {
        userId: ctx.userId,
        toolName: EXPORT_MENTAL_HEALTH_TOOL,
        argsHash,
      }),
    );
    if (!valid) {
      // FINDING (pre-Milestone-8 audit, 2026-09-21): an invalid/expired
      // confirmation token on a mental-health export is exactly the kind
      // of event that should leave a trace — it's indistinguishable at
      // this layer from a stolen session probing for sensitive data, and
      // the denial previously vanished with no audit_log row at all.
      await this.db.runAsUser(ctx.userId, (client) =>
        this.auditLog.record(client, {
          actorType: 'user',
          actingAsUserId: ctx.userId,
          action: 'privacy.export.mental_health_denied',
          resourceType: 'confirmation_tokens',
          result: 'denied',
        }),
      );
      return { status: 'denied', reason: 'invalid or expired confirmation' };
    }
    return this.exportBundle.build(ctx.userId, true);
  }

  @Post('account/delete')
  @HttpCode(200)
  @RequiredScope('account.delete')
  async requestDeletion(@CurrentUser() ctx: RequestContext, @Body() dto: RequestDeletionDto) {
    return this.accountDeletion.requestDeletion(ctx.userId, { immediate: dto.immediate ?? false });
  }

  @Post('account/delete/cancel')
  @HttpCode(200)
  @RequiredScope('account.delete')
  async cancelDeletion(@CurrentUser() ctx: RequestContext) {
    await this.accountDeletion.cancelDeletion(ctx.userId);
    return { cancelled: true };
  }
}
