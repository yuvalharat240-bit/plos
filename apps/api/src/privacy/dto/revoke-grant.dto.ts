import { IsString, MinLength } from 'class-validator';

export class RevokeGrantDto {
  @IsString()
  @MinLength(1)
  scope!: string;
}
