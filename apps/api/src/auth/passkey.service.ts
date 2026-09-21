import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import type {
  AuthenticatorDevice,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/types';
import { PoolClient } from 'pg';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

interface PendingChallenge {
  challenge: string;
  userId?: string; // present for registration, absent for a discoverable-credential login
  expiresAt: number;
}

/**
 * docs/09 Milestone 2 / ADR D7 (Passkeys). Registration requires an
 * already-authenticated user (adding a passkey to an existing account);
 * login is the discoverable-credential (resident key) flow — no username
 * field, matching the "Use a Passkey instead" button next to Sign in with
 * Apple that has no text field in front of it.
 *
 * The in-memory challenge map is a deliberate simplification: a
 * WebAuthn ceremony's challenge only needs to live for the few seconds
 * between the options call and the verify call, so it doesn't warrant a
 * DB table/column of its own.
 * ponytail: single-process in-memory challenge store; move to a shared
 * store (Redis) if apps/api ever runs more than one instance — Milestone
 * 8 territory, not before.
 */
@Injectable()
export class PasskeyService {
  private readonly pending = new Map<string, PendingChallenge>();

  private get rpID(): string {
    return process.env.WEBAUTHN_RP_ID ?? 'localhost';
  }

  private get rpName(): string {
    return 'plos';
  }

  private get expectedOrigin(): string | string[] {
    const configured = process.env.WEBAUTHN_ORIGIN;
    return configured ? configured.split(',') : [`https://${this.rpID}`];
  }

  private storeChallenge(challenge: string, userId?: string): string {
    this.reapExpired();
    const attemptId = randomUUID();
    this.pending.set(attemptId, { challenge, userId, expiresAt: Date.now() + CHALLENGE_TTL_MS });
    return attemptId;
  }

  private consumeChallenge(attemptId: string): PendingChallenge {
    const attempt = this.pending.get(attemptId);
    this.pending.delete(attemptId);
    if (!attempt || attempt.expiresAt < Date.now()) {
      throw new UnauthorizedException('passkey ceremony expired or unknown');
    }
    return attempt;
  }

  private reapExpired(): void {
    const now = Date.now();
    for (const [id, attempt] of this.pending) {
      if (attempt.expiresAt < now) this.pending.delete(id);
    }
  }

  /** UUIDs aren't valid WebAuthn user handles as-is; strip the dashes to raw bytes. */
  private userIdToHandle(userId: string): Uint8Array {
    return Buffer.from(userId.replace(/-/g, ''), 'hex');
  }

  async generateRegistration(
    client: PoolClient,
    userId: string,
    username: string,
  ): Promise<{ attemptId: string; options: PublicKeyCredentialCreationOptionsJSON }> {
    const existing = await client.query(
      `SELECT credential_id FROM webauthn_credentials WHERE user_id = $1`,
      [userId],
    );
    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpID,
      userID: this.userIdToHandle(userId),
      userName: username,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      excludeCredentials: existing.rows.map((row) => ({
        id: isoBase64URL.fromBuffer(new Uint8Array(row.credential_id)),
      })),
    });
    const attemptId = this.storeChallenge(options.challenge, userId);
    return { attemptId, options };
  }

  async verifyRegistration(
    attemptId: string,
    userId: string,
    response: RegistrationResponseJSON,
  ): Promise<{ credentialId: Buffer; publicKey: Buffer }> {
    const attempt = this.consumeChallenge(attemptId);
    if (attempt.userId !== userId) {
      throw new UnauthorizedException('passkey registration attempt does not belong to this user');
    }
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge: attempt.challenge,
      expectedOrigin: this.expectedOrigin,
      expectedRPID: this.rpID,
    });
    if (!result.verified || !result.registrationInfo) {
      throw new UnauthorizedException('passkey registration could not be verified');
    }
    return {
      credentialId: Buffer.from(isoBase64URL.toBuffer(result.registrationInfo.credentialID)),
      publicKey: Buffer.from(result.registrationInfo.credentialPublicKey),
    };
  }

  async generateAuthentication(): Promise<{
    attemptId: string;
    options: PublicKeyCredentialRequestOptionsJSON;
  }> {
    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      userVerification: 'preferred',
      // No allowCredentials: a discoverable-credential (resident key) login —
      // the authenticator itself presents which credential to use, since we
      // don't know the user yet (that's the point of passkey login).
    });
    const attemptId = this.storeChallenge(options.challenge);
    return { attemptId, options };
  }

  /** Returns the credential ID (raw bytes) the client asserted with, before we know who it belongs to. */
  extractCredentialId(response: AuthenticationResponseJSON): Buffer {
    return Buffer.from(isoBase64URL.toBuffer(response.rawId));
  }

  async verifyAuthentication(
    attemptId: string,
    response: AuthenticationResponseJSON,
    storedCredential: { credentialId: Buffer; publicKey: Buffer; signCount: number },
  ): Promise<{ newCounter: number }> {
    const attempt = this.consumeChallenge(attemptId);
    const authenticator: AuthenticatorDevice = {
      credentialID: isoBase64URL.fromBuffer(new Uint8Array(storedCredential.credentialId)),
      credentialPublicKey: new Uint8Array(storedCredential.publicKey),
      counter: storedCredential.signCount,
    };
    // FINDING (security review, docs/09 Milestone 7): `@simplewebauthn/server`
    // has its own internal counter-regression check and THROWS a plain
    // Error ("Response counter value N was lower than expected M")
    // rather than returning `verified: false` — uncaught, this surfaced
    // as a raw 500 instead of a clean auth rejection. Caught here and
    // folded into the same UnauthorizedException the `!result.verified`
    // branch already uses, since both mean the same thing to a caller:
    // this assertion did not check out. `auth.controller.ts`'s own
    // counter re-check right after this call is a second, explicit,
    // application-owned statement of the same invariant — kept
    // deliberately, so this codebase's own clone-detection guarantee
    // doesn't depend entirely on a third-party library's internal
    // behavior never changing.
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: attempt.challenge,
        expectedOrigin: this.expectedOrigin,
        expectedRPID: this.rpID,
        authenticator,
      });
    } catch (err) {
      throw new UnauthorizedException(`passkey authentication could not be verified: ${(err as Error).message}`);
    }
    if (!result.verified) {
      throw new UnauthorizedException('passkey authentication could not be verified');
    }
    return { newCounter: result.authenticationInfo.newCounter };
  }
}
