import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

/**
 * docs/09 Milestone 3: HealthKit/EventKit sync is client-driven and can
 * legitimately re-send the same sample twice (retried sync, overlapping
 * date ranges) — this must be idempotent, not just "insert." Every
 * imported sample carries a stable `sourceId` from Apple's own store
 * (HKObject.uuid / EventKit's eventIdentifier), which is exactly what
 * `uq_core_objects_provider_source` (docs/04 §3 spine, `WHERE provider
 * IS NOT NULL AND source_id IS NOT NULL`) was built for.
 */
@Injectable()
export class ImportService {
  /** Returns the new core_objects.id, or null if this exact (provider, source, source_id) already exists — the caller should skip the domain-table insert in that case, not retry it. */
  async insertSpineIfNew(
    client: PoolClient,
    userId: string,
    objectType: 'observation' | 'event',
    source: string,
    provider: string,
    sourceId: string,
    originalTimestamp: string,
  ): Promise<string | null> {
    const result = await client.query(
      `INSERT INTO core_objects (user_id, object_type, source, provider, source_id, original_timestamp, is_imported)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (provider, source, source_id) WHERE provider IS NOT NULL AND source_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [userId, objectType, source, provider, sourceId, originalTimestamp],
    );
    return result.rows[0]?.id ?? null;
  }
}
