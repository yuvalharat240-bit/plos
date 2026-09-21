import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class RequestExportDto {
  @IsBoolean()
  @IsOptional()
  includeMentalHealth?: boolean;

  @IsString()
  @IsOptional()
  confirmationToken?: string;
}
