import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ScopeGuard } from '../auth/guards/scope.guard';
import { EntitlementGuard } from '../auth/guards/entitlement.guard';
import { RequiredScope } from '../auth/decorators/required-scope.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestContext } from '../auth/request-context';
import { HealthSyncService } from './health-sync.service';
import { CalendarSyncService } from './calendar-sync.service';
import { HealthSyncDto } from './dto/health-sync.dto';
import { CalendarSyncDto } from './dto/calendar-sync.dto';

@Controller('v1/sync')
@UseGuards(AuthGuard, ScopeGuard, EntitlementGuard)
export class SyncController {
  constructor(
    private readonly health: HealthSyncService,
    private readonly calendar: CalendarSyncService,
  ) {}

  @Post('health')
  @HttpCode(200)
  @RequiredScope('health.write')
  async syncHealth(@CurrentUser() ctx: RequestContext, @Body() dto: HealthSyncDto) {
    return this.health.sync(ctx.userId, dto);
  }

  @Post('calendar')
  @HttpCode(200)
  @RequiredScope('productivity.write')
  async syncCalendar(@CurrentUser() ctx: RequestContext, @Body() dto: CalendarSyncDto) {
    return this.calendar.sync(ctx.userId, dto);
  }
}
