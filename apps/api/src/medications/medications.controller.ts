import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ScopeGuard } from '../auth/guards/scope.guard';
import { EntitlementGuard } from '../auth/guards/entitlement.guard';
import { RequiredScope } from '../auth/decorators/required-scope.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestContext } from '../auth/request-context';
import { MedicationsService } from './medications.service';
import { CreateMedicationLogDto } from './dto/create-medication-log.dto';

@Controller('v1/medications')
@UseGuards(AuthGuard, ScopeGuard, EntitlementGuard)
export class MedicationsController {
  constructor(private readonly medications: MedicationsService) {}

  @Post()
  @HttpCode(201)
  @RequiredScope('health.write')
  async create(@CurrentUser() ctx: RequestContext, @Body() dto: CreateMedicationLogDto) {
    return this.medications.logDose(ctx.userId, dto);
  }
}
