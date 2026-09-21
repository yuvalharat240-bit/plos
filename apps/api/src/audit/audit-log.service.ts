import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AuditLogEntry } from './audit-log.entry';

/**
 * Writes one audit_log row using the caller's already-open, already
 * tenant-scoped `client` (from TenantDatabaseService.runAsUser). Every
 * CRUD write and every auth event goes through this, on the same
 * connection/transaction as the write it's recording, so a rolled-back
 * write never leaves an orphaned audit row and vice versa
 * (docs/09 Milestone 2: "every write goes through the same RLS session
 * variable and audit-log path as agent tools").
 *
 * This service owns no connection itself — it's a plain SQL-shaping
 * helper, not a place that could accidentally bypass RLS.
 */
@Injectable()
export class AuditLogService {
  async record(client: PoolClient, entry: AuditLogEntry): Promise<void> {
    await client.query(
      `INSERT INTO audit_log
         (actor_type, actor_id, acting_as_user_id, action, resource_type,
          resource_id, risk_tier, request_id, result, metadata,
          agent_version, model_version, args_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        entry.actorType,
        entry.actorId ?? null,
        entry.actingAsUserId,
        entry.action,
        entry.resourceType ?? null,
        entry.resourceId ?? null,
        entry.riskTier ?? null,
        entry.requestId ?? null,
        entry.result,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        entry.agentVersion ?? null,
        entry.modelVersion ?? null,
        entry.argsHash ?? null,
      ],
    );
  }
}
