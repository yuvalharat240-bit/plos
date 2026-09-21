import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ScopeGuard } from '../auth/guards/scope.guard';
import { EntitlementGuard } from '../auth/guards/entitlement.guard';
import { RequiredScope } from '../auth/decorators/required-scope.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestContext } from '../auth/request-context';
import { WorkoutsService } from './workouts.service';
import { CreateWorkoutDto } from './dto/create-workout.dto';

@Controller('v1/workouts')
@UseGuards(AuthGuard, ScopeGuard, EntitlementGuard)
export class WorkoutsController {
  constructor(private readonly workouts: WorkoutsService) {}

  @Post()
  @HttpCode(201)
  @RequiredScope('fitness.write')
  async create(@CurrentUser() ctx: RequestContext, @Body() dto: CreateWorkoutDto) {
    return this.workouts.createWorkout(ctx.userId, dto);
  }
}
