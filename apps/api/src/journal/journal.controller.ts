import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ScopeGuard } from '../auth/guards/scope.guard';
import { EntitlementGuard } from '../auth/guards/entitlement.guard';
import { RequiredScope } from '../auth/decorators/required-scope.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestContext } from '../auth/request-context';
import { JournalService } from './journal.service';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';

@Controller('v1/journal')
@UseGuards(AuthGuard, ScopeGuard, EntitlementGuard)
export class JournalController {
  constructor(private readonly journal: JournalService) {}

  @Post()
  @HttpCode(201)
  @RequiredScope('mental_health.write')
  async create(@CurrentUser() ctx: RequestContext, @Body() dto: CreateJournalEntryDto) {
    return this.journal.createEntry(ctx.userId, dto);
  }
}
