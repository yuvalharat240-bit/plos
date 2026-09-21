import { IsIn } from 'class-validator';
import { MVP_CONSENT_TYPES, MvpConsentType } from '../consent.service';

export class ConsentActionDto {
  @IsIn(MVP_CONSENT_TYPES)
  consentType!: MvpConsentType;
}
