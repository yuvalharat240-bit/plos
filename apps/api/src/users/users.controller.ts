import { Body, Controller, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestContext } from '../auth/request-context';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

/**
 * `AuthGuard` only — no `@RequiredScope()`. Updating one's own display
 * name/primary goal isn't domain data covered by the docs/07 §3.2
 * permission-scope catalog (health/fitness/mental_health/productivity/
 * professional/account/consent); it's basic first-party profile
 * ownership, not a scoped grant. Revisit only if a future privacy-model
 * revision says otherwise.
 */
@Controller('v1/users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Patch('me')
  async updateProfile(@CurrentUser() ctx: RequestContext, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(ctx.userId, dto);
  }
}
