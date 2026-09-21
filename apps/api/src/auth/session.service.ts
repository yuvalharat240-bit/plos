import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PoolClient } from 'pg';

/**
 * `sessions` (docs/04 §7.1) — refresh tokens are stored only as a SHA-256
 * hash (`refresh_token_hash`), never the raw value; the raw token is
 * returned to the client exactly once, at issuance/rotation, and never
 * persisted anywhere in plaintext.
 */
@Injectable()
export class SessionService {
  hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  private generateRawToken(): string {
    return randomBytes(32).toString('base64url');
  }

  async createSession(
    client: PoolClient,
    userId: string,
    deviceInfo?: Record<string, unknown>,
  ): Promise<{ sessionId: string; refreshToken: string }> {
    const refreshToken = this.generateRawToken();
    const result = await client.query(
      `INSERT INTO sessions (user_id, refresh_token_hash, device_info)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [userId, this.hashToken(refreshToken), deviceInfo ? JSON.stringify(deviceInfo) : null],
    );
    return { sessionId: result.rows[0].id, refreshToken };
  }

  async rotateRefreshToken(client: PoolClient, sessionId: string): Promise<string> {
    const refreshToken = this.generateRawToken();
    await client.query(
      `UPDATE sessions
       SET refresh_token_hash = $1, last_used_at = now()
       WHERE id = $2`,
      [this.hashToken(refreshToken), sessionId],
    );
    return refreshToken;
  }

  async revokeSession(client: PoolClient, sessionId: string, reason: string): Promise<void> {
    await client.query(
      `UPDATE sessions SET revoked_at = now(), revoked_reason = $1 WHERE id = $2`,
      [reason, sessionId],
    );
  }
}
