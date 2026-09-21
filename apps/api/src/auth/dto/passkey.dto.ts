import { IsObject, IsOptional, IsString } from 'class-validator';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/types';

/**
 * `response` is a WebAuthn ceremony payload with its own well-defined,
 * deeply-nested shape (per the WebAuthn spec) that @simplewebauthn/server's
 * verify functions already validate byte-for-byte — re-validating its
 * internal structure with class-validator decorators would duplicate
 * that, worse. Only the outer envelope is validated here; a malformed
 * `response` fails inside verifyRegistrationResponse/
 * verifyAuthenticationResponse instead, which is the correct place for
 * that failure to surface.
 */
export class PasskeyRegisterVerifyDto {
  @IsString()
  attemptId!: string;

  @IsObject()
  response!: RegistrationResponseJSON;

  @IsString()
  @IsOptional()
  deviceName?: string;
}

export class PasskeyLoginVerifyDto {
  @IsString()
  attemptId!: string;

  @IsObject()
  response!: AuthenticationResponseJSON;
}
