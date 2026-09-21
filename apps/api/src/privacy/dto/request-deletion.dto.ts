import { IsBoolean, IsOptional } from 'class-validator';

export class RequestDeletionDto {
  @IsBoolean()
  @IsOptional()
  immediate?: boolean;
}
