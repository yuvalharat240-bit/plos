import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID, createHash } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';

const CONFIRMATION_TTL_SECONDS = 5 * 60;
const ISSUER = 'plos-api-agent-confirmations';

/**
 * docs/06-threat-model.md T7's must-fix: "confirmation-token binding
 * (scoped, single-use, time-boxed HMAC) before any Tier 2+ tool is
 * implemented." Mirrors TokenService's own HS256-via-`jose` pattern
 * (auth/token.service.ts) rather than hand-rolling raw HMAC — same
 * already-installed dependency, same dev-secret convention.
 *
 * The signed JWT alone only proves the token wasn't forged and hasn't
 * expired; it does NOT prove it hasn't already been redeemed once. Single-
 * use is enforced by `agent_confirmations` (027_agent_ask_and_confirmations.js):
 * `verifyAndConsume` atomically flips `used_at` and only succeeds if it
 * was still NULL, inside the caller's own `runAsUser` transaction — so a
 * replayed token loses the race against itself, not against a clock.
 */
export interface ConfirmationToken {
  token: string;
  expiresAt: Date;
}

@Injectable()
export class ConfirmationTokenService {
  private readonly secret = new TextEncoder().encode(
    process.env.AGENT_CONFIRMATION_SECRET ?? 'plos_agent_confirmation_dev_only_secret',
  );

  static hashArgs(args: unknown): string {
    return createHash('sha256').update(JSON.stringify(args ?? null)).digest('hex');
  }

  /** Mints a token AND records its nonce in `agent_confirmations` — the
   * two must happen together, on the same transaction as the rest of the
   * tool chain, or a minted-but-unrecorded token could be replayed
   * indefinitely (a signature check alone can't see a DB row that was
   * never written). */
  async issue(
    client: PoolClient,
    input: { userId: string; toolName: string; argsHash: string },
  ): Promise<ConfirmationToken> {
    const nonce = randomUUID();
    const expiresAt = new Date(Date.now() + CONFIRMATION_TTL_SECONDS * 1000);

    await client.query(
      `INSERT INTO agent_confirmations (nonce, user_id, tool_name, args_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [nonce, input.userId, input.toolName, input.argsHash, expiresAt],
    );

    const token = await new SignJWT({ toolName: input.toolName, argsHash: input.argsHash })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(input.userId)
      .setIssuer(ISSUER)
      .setJti(nonce)
      .setIssuedAt()
      .setExpirationTime(`${CONFIRMATION_TTL_SECONDS}s`)
      .sign(this.secret);

    return { token, expiresAt };
  }

  /** Verifies the signature/binding, then atomically consumes the nonce.
   * Returns false for: bad signature, expired, wrong user/tool/args bound
   * into the token, or a nonce that was already used (replay). Every
   * failure mode collapses to the same boolean on purpose — the caller
   * (ToolExecutorService) treats all of them identically: deny and audit,
   * never leak which specific check failed. */
  async verifyAndConsume(
    client: PoolClient,
    token: string,
    expected: { userId: string; toolName: string; argsHash: string },
  ): Promise<boolean> {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, this.secret, { issuer: ISSUER }));
    } catch {
      return false;
    }

    if (
      payload.sub !== expected.userId ||
      payload.toolName !== expected.toolName ||
      payload.argsHash !== expected.argsHash ||
      typeof payload.jti !== 'string'
    ) {
      return false;
    }

    const result = await client.query(
      `UPDATE agent_confirmations
         SET used_at = now()
       WHERE nonce = $1 AND user_id = $2 AND used_at IS NULL AND expires_at > now()
       RETURNING nonce`,
      [payload.jti, expected.userId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
