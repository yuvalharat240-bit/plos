import { IsIn, IsOptional, IsString } from 'class-validator';

/** SignUpView's onboarding screen (product vision §26): name + one primary goal, nothing else. */
export class UpdateProfileDto {
  @IsString()
  @IsOptional()
  displayName?: string;

  @IsIn(['Sleep better', 'Train consistently', 'Manage stress', 'Just exploring'])
  @IsOptional()
  primaryGoal?: string;
}
