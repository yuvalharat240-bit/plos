import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { TenantDatabaseService } from '../database/tenant-database.service';
import { AuditLogService } from '../audit/audit-log.service';
import { ExportBundleStorageService, StoredObjectRef } from './export-bundle-storage.service';

const GRACE_PERIOD_DAYS = 14;

export interface DeletionRequestResult {
  status: 'pending_deletion' | 'deleted';
  deletionEligibleAt: Date | null;
}

/**
 * docs/07-privacy-model.md §7's full 8-step workflow, against the real
 * MVP-populated tables (docs/08 §4.1) — actually simpler at MVP scale
 * exactly as docs/08 §7 predicts: no `clinical_memories` rows to purge,
 * no financial/S3-beyond-exports data. Every hard DELETE below runs
 * inside one `runAsUser` transaction, same as every other write path in
 * this codebase — a failure partway through rolls the whole finalize
 * back rather than leaving a half-deleted account.
 */
@Injectable()
export class AccountDeletionService {
  constructor(
    private readonly db: TenantDatabaseService,
    private readonly auditLog: AuditLogService,
    private readonly storage: ExportBundleStorageService,
  ) {}

  /** Steps 1-2 (docs/07 §7): revoke integrations, invalidate sessions —
   * these run immediately regardless of the grace period, since
   * security-sensitive revocation shouldn't wait on it.
   *
   * FINDING (security review, docs/09 Milestone 7): `webauthn_credentials`
   * used to be hard-deleted here too, immediately, even for a
   * cancellable (`immediate: false`) request — but deleting a passkey
   * credential can't be undone the way `cancelDeletion` undoes the
   * `users.status` flip. A user who requested deletion, then cancelled
   * within the grace period, found themselves permanently locked out of
   * passkey sign-in for no reason tied to any actual security need
   * (session revocation, which DOES run here immediately, already
   * prevents a stolen session token from being used during the grace
   * window). Credential deletion now happens in `finalizeDeletion`
   * instead — only once the deletion is no longer cancellable. */
  async requestDeletion(
    userId: string,
    opts: { immediate: boolean; reason?: string },
  ): Promise<DeletionRequestResult> {
    await this.db.runAsUser(userId, async (client) => {
      await client.query(
        `UPDATE integrations SET status = 'revoked' WHERE user_id = $1 AND status <> 'revoked'`,
        [userId],
      );
      await client.query(
        `UPDATE sessions SET revoked_at = now(), revoked_reason = 'account_deletion'
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );

      await this.auditLog.record(client, {
        actorType: 'user',
        actingAsUserId: userId,
        action: 'account.integrations_revoked',
        result: 'success',
        metadata: { reason: opts.reason ?? 'user_request' },
      });
      await this.auditLog.record(client, {
        actorType: 'user',
        actingAsUserId: userId,
        action: 'account.sessions_invalidated',
        result: 'success',
      });
    });

    await this.db.runPreAuth((client) =>
      client.query(
        `UPDATE users SET status = 'pending_deletion', deletion_requested_at = now() WHERE id = $1`,
        [userId],
      ),
    );

    if (opts.immediate) {
      await this.finalizeDeletion(userId);
      return { status: 'deleted', deletionEligibleAt: null };
    }

    return {
      status: 'pending_deletion',
      deletionEligibleAt: new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000),
    };
  }

  /** docs/07 §7's preamble: "lets the user cancel before any hard
   * deletion below runs" — only meaningful while status is still
   * `pending_deletion` (steps 3-8 haven't run yet). */
  async cancelDeletion(userId: string): Promise<void> {
    await this.db.runPreAuth(async (client) => {
      const result = await client.query(
        `UPDATE users SET status = 'active', deletion_requested_at = NULL
         WHERE id = $1 AND status = 'pending_deletion' RETURNING id`,
        [userId],
      );
      if (result.rowCount === 0) {
        throw new Error('account is not in a cancellable pending_deletion state');
      }
    });
    await this.db.runAsUser(userId, (client) =>
      this.auditLog.record(client, {
        actorType: 'user',
        actingAsUserId: userId,
        action: 'account.deletion_cancelled',
        result: 'success',
      }),
    );
  }

  /** Steps 3-8. Called immediately for a "delete now" request, or (not
   * built here — no scheduler infra exists yet, same class of gap as the
   * worker's own "an external scheduler calls it repeatedly," docs/09
   * Milestone 4) by a future scheduled job once the grace period elapses. */
  async finalizeDeletion(userId: string): Promise<void> {
    const documentRefs: StoredObjectRef[] = await this.db.runAsUser(userId, (client) => this.deleteAllRows(client, userId));

    // Step 5: object storage — outside the DB transaction on purpose,
    // deleting real bytes only after the rows that reference them are
    // durably gone. Each document's cleanup is independent I/O (not even
    // a DB call), so they run concurrently rather than one at a time.
    await Promise.all(documentRefs.map((ref) => this.storage.deleteAllVersions(ref.bucket, ref.key)));

    await this.db.runAsUser(userId, (client) =>
      this.auditLog.record(client, {
        actorType: 'system',
        actingAsUserId: userId,
        action: 'account.data_deleted',
        result: 'success',
        metadata: { documentsDeleted: documentRefs.length },
      }),
    );

    // Step 8: anonymize, don't delete, the `users` row.
    //
    // FINDING: docs/07 §7 step 8 says to null `apple_sub`, but
    // docs/04 §7.1's actual DDL declares `apple_sub TEXT UNIQUE NOT
    // NULL` — nulling it would violate that column's own NOT NULL
    // constraint (and a real `NULL` wouldn't violate UNIQUE regardless,
    // since Postgres treats NULLs as distinct for uniqueness, but the
    // NOT NULL constraint still rejects it outright). Same category of
    // doc-vs-DDL conflict 020/024/025 already found and fixed — resolved
    // the same way: the concrete DDL wins. A deterministic, content-free
    // tombstone value (`deleted-<id>`) satisfies both constraints while
    // still removing every trace of the real Apple identity.
    await this.db.runPreAuth((client) =>
      client.query(
        `UPDATE users SET apple_sub = 'deleted-' || id::text, email = NULL, display_name = NULL,
                status = 'deleted', deleted_at = now(), deletion_requested_at = NULL
         WHERE id = $1`,
        [userId],
      ),
    );

    await this.db.runAsUser(userId, (client) =>
      this.auditLog.record(client, {
        actorType: 'system',
        actingAsUserId: userId,
        action: 'account.deletion_completed',
        result: 'success',
      }),
    );
  }

  private async deleteAllRows(client: PoolClient, userId: string): Promise<StoredObjectRef[]> {
    const documents = await client.query(
      `SELECT s3_bucket, s3_key, s3_version_id FROM documents WHERE user_id = $1`,
      [userId],
    );
    const documentRefs: StoredObjectRef[] = documents.rows.map((r) => ({
      bucket: r.s3_bucket,
      key: r.s3_key,
      versionId: r.s3_version_id,
    }));

    // Non-cascading references have to go before the core_objects rows
    // they point at, or the DELETE below hits a foreign-key violation —
    // found by running this against real Postgres, not assumed correct
    // from reading the schema doc alone.
    await client.query(
      `DELETE FROM agent_output_sources
       WHERE output_id IN (SELECT id FROM agent_outputs WHERE user_id = $1)
          OR source_output_id IN (SELECT id FROM agent_outputs WHERE user_id = $1)`,
      [userId],
    );
    await client.query(`DELETE FROM relationships WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM outcomes WHERE user_id = $1`, [userId]);
    await client.query(
      `UPDATE decisions SET prompted_by_output_id = NULL, chosen_action_id = NULL WHERE user_id = $1`,
      [userId],
    );

    // History tables: purged explicitly, never FK-cascaded (docs/07 §5).
    await client.query(`DELETE FROM memory_history WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM clinical_memory_history WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM goal_history WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM document_history WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM financial_account_history WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM health_profile_history WHERE user_id = $1`, [userId]);

    // Step 4 (derived) + step 3 (active) via the shared spine — every
    // extension table (observations/*, events/*, entities/*, etc.)
    // cascades automatically from its 1:1 parent's ON DELETE CASCADE.
    await client.query(
      `DELETE FROM baselines WHERE user_id = $1`,
      [userId],
    );
    await client.query(`DELETE FROM timeline_entries WHERE user_id = $1`, [userId]);
    // FINDING (security review, docs/09 Milestone 7): 'relationship' and
    // 'outcome' were missing from this list. Their own extension-table
    // rows are deleted above (the non-cascading-reference block), but
    // deleting a child row never cascades back up to its core_objects
    // parent — without these two, every relationship/outcome this user
    // ever had left an orphaned spine row (source, provenance,
    // confidence, still keyed to the user) behind forever, contradicting
    // docs/07 §7 steps 3-4's explicit list of what must be hard-deleted.
    await client.query(
      `DELETE FROM core_objects WHERE user_id = $1 AND object_type IN
         ('memory','clinical_memory','agent_output','entity','event','observation','goal','action','decision','document','relationship','outcome')`,
      [userId],
    );

    await client.query(`DELETE FROM health_profile WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM financial_accounts WHERE user_id = $1`, [userId]);
    await client.query(
      `DELETE FROM agent_turns WHERE conversation_id IN (SELECT id FROM agent_conversations WHERE user_id = $1)`,
      [userId],
    );
    await client.query(`DELETE FROM agent_conversations WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM integrations WHERE user_id = $1`, [userId]);
    // Not in docs/07 §7 (written before Milestone 5 added this table) —
    // cleaned up here too since it's the same user-owned, ephemeral-by-
    // design data the rest of this step targets.
    await client.query(`DELETE FROM agent_confirmations WHERE user_id = $1`, [userId]);
    // Moved here from requestDeletion's immediate step 2 — see that
    // method's own comment for why (a cancellable grace-period request
    // shouldn't permanently destroy a passkey credential).
    await client.query(`DELETE FROM webauthn_credentials WHERE user_id = $1`, [userId]);

    // Step 6 (vector representations) is a verification-only line item,
    // not code: `embeddings.core_object_id REFERENCES core_objects(id)
    // ON DELETE CASCADE` (docs/04 §4.4) means every embedding this user
    // could ever have had is already gone by construction — and none
    // exist at MVP regardless (docs/08 §9.1).

    return documentRefs;
  }
}
