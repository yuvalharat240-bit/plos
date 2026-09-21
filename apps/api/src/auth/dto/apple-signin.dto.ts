import { IsObject, IsOptional, IsString } from 'class-validator';

export class AppleSignInDto {
  @IsString()
  identityToken!: string;

  @IsObject()
  @IsOptional()
  deviceInfo?: Record<string, unknown>;
}
