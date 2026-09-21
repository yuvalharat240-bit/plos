import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import type { ZipArchive as ZipArchiveType } from 'archiver';
import { createHash } from 'crypto';
import { TenantDatabaseService } from '../database/tenant-database.service';
import { AuditLogService } from '../audit/audit-log.service';
import { ExportBundleStorageService } from './export-bundle-storage.service';

export interface ExportBundleResult {
  documentId: string;
  downloadUrl: string;
  expiresAt: Date;
  sections: string[];
}

/**
 * docs/07-privacy-model.md §8, reduced to docs/08-mvp-definition.md §7's
 * exact folder set: only `profile/`, `goals/`, `health/`, `fitness/`,
 * `mental_health/` (gated), `memories/`, `ai/`, `audit/` are ever
 * non-empty — every other domain's directory is simply absent, since no
 * data was ever collected there, not shipped as an empty stub.
 */
@Injectable()
export class ExportBundleService {
  constructor(
    private readonly db: TenantDatabaseService,
    private readonly storage: ExportBundleStorageService,
    private readonly auditLog: AuditLogService,
  ) {}

  async build(userId: string, includeMentalHealth: boolean): Promise<ExportBundleResult> {
    return this.db.runAsUser(userId, async (client) => {
      const files: Array<{ path: string; content: string }> = [];
      const addJson = (sectionPath: string, data: unknown) => {
        files.push({ path: sectionPath, content: JSON.stringify(data, null, 2) });
      };

      addJson('profile/account.json', await this.profileSection(client, userId));
      addJson('profile/consent_history.json', await rows(client, `SELECT * FROM consent_records WHERE user_id = $1 ORDER BY granted_at`, [userId]));
      addJson('profile/permission_history.json', await rows(client, `SELECT * FROM permission_grants WHERE user_id = $1 ORDER BY granted_at`, [userId]));

      addJson('goals/goals.json', await this.goalsSection(client, userId));

      addJson('health/vitals.json', await rows(
        client,
        `SELECT o.observed_at, v.vital_type, v.value_numeric, v.unit
         FROM observations o JOIN observation_vital v ON v.observation_id = o.id
         WHERE o.user_id = $1 ORDER BY o.observed_at`,
        [userId],
      ));
      addJson('health/sleep.json', await rows(
        client,
        `SELECT o.observed_at, s.sleep_start, s.sleep_end, s.duration_min, s.sleep_score
         FROM observations o JOIN observation_sleep s ON s.observation_id = o.id
         WHERE o.user_id = $1 ORDER BY o.observed_at`,
        [userId],
      ));
      addJson('health/injury_flags.json', await rows(
        client,
        `SELECT o.observed_at, i.body_part, i.severity, i.flagged_by, i.active, i.started_at, i.resolved_at
         FROM observations o JOIN observation_injury_flag i ON i.observation_id = o.id
         WHERE o.user_id = $1 ORDER BY o.observed_at`,
        [userId],
      ));
      addJson('health/health_profile.json', {
        current: await rows(client, `SELECT * FROM health_profile WHERE user_id = $1`, [userId]),
        history: await rows(client, `SELECT * FROM health_profile_history WHERE user_id = $1 ORDER BY changed_at`, [userId]),
      });

      addJson('fitness/sessions.json', await rows(
        client,
        `SELECT e.id, e.starts_at, e.ends_at, e.status, f.sport_type, f.duration_min, f.distance_km,
                f.avg_hr, f.max_hr, f.calories, f.perceived_exertion, f.training_load
         FROM events e JOIN event_fitness_session f ON f.event_id = e.id
         WHERE e.user_id = $1 ORDER BY e.starts_at`,
        [userId],
      ));

      const sections = ['profile', 'goals', 'health', 'fitness', 'memories', 'ai', 'audit'];
      if (includeMentalHealth) {
        addJson('mental_health/journal.json', await rows(
          client,
          `SELECT o.observed_at, j.entry_kind, j.entry_text, j.mood_score, j.stress_score, j.energy_score, j.tags
           FROM observations o JOIN observation_journal_entry j ON j.observation_id = o.id
           WHERE o.user_id = $1 ORDER BY o.observed_at`,
          [userId],
        ));
        sections.splice(4, 0, 'mental_health');
      }

      addJson('memories/memories.json', {
        memories: await rows(client, `SELECT * FROM memories WHERE user_id = $1 ORDER BY created_at`, [userId]),
        reasons: await rows(
          client,
          `SELECT r.* FROM memory_reasons r JOIN memories m ON m.id = r.memory_id WHERE m.user_id = $1`,
          [userId],
        ),
        history: await rows(client, `SELECT * FROM memory_history WHERE user_id = $1 ORDER BY changed_at`, [userId]),
      });

      addJson('ai/agent_outputs.json', await rows(
        client,
        `SELECT ao.*, co.epistemic_status, co.confidence, co.agent_version
         FROM agent_outputs ao JOIN core_objects co ON co.id = ao.id
         WHERE ao.user_id = $1 ORDER BY co.created_at`,
        [userId],
      ));
      addJson('ai/baselines_snapshot.json', await rows(
        client,
        `SELECT domain, metric, window_days, mean, stddev, current_value, deviation_z, classification, computed_at
         FROM baselines WHERE user_id = $1 ORDER BY domain, metric`,
        [userId],
      ));

      addJson('audit/my_actions.json', await rows(
        client,
        `SELECT occurred_at, action, resource_type, result, risk_tier FROM audit_log
         WHERE acting_as_user_id = $1 ORDER BY occurred_at`,
        [userId],
      ));

      const manifest = {
        userId,
        generatedAt: new Date().toISOString(),
        schemaVersion: 1,
        sections,
        sha256PerFile: Object.fromEntries(
          files.map((f) => [f.path, createHash('sha256').update(f.content).digest('hex')]),
        ),
      };
      files.unshift({ path: 'manifest.json', content: JSON.stringify(manifest, null, 2) });

      const zipBuffer = await zip(files);
      const bucket = 'plos-export-bundles';
      const key = `${userId}/export-${Date.now()}.zip`;
      const ref = await this.storage.put(bucket, key, zipBuffer);

      const spine = await client.query(
        `INSERT INTO core_objects (user_id, object_type, source, is_user_entered)
         VALUES ($1, 'document', 'user_entry', true) RETURNING id`,
        [userId],
      );
      const documentId: string = spine.rows[0].id;
      const checksum = createHash('sha256').update(zipBuffer).digest('hex');
      await client.query(
        `INSERT INTO documents (id, user_id, document_type, s3_bucket, s3_key, s3_version_id, mime_type, filename, size_bytes, checksum_sha256)
         VALUES ($1, $2, 'export_bundle', $3, $4, $5, 'application/zip', $6, $7, $8)`,
        [documentId, userId, ref.bucket, ref.key, ref.versionId, `plos-export-${userId}.zip`, zipBuffer.length, checksum],
      );

      const { token, expiresAt } = await this.storage.mintDownloadToken(userId, ref);

      await this.auditLog.record(client, {
        actorType: 'user',
        actingAsUserId: userId,
        action: 'export.request',
        resourceType: 'documents',
        resourceId: documentId,
        result: 'success',
        metadata: { sections, includeMentalHealth, sizeBytes: zipBuffer.length },
      });

      return {
        documentId,
        downloadUrl: `/v1/privacy/exports/download?token=${encodeURIComponent(token)}`,
        expiresAt,
        sections,
      };
    });
  }

  private async profileSection(client: PoolClient, userId: string) {
    const account = await rows(
      client,
      `SELECT id, email, display_name, status, created_at FROM users WHERE id = $1`,
      [userId],
    );
    const roles = await rows(client, `SELECT role, granted_at FROM user_roles WHERE user_id = $1`, [userId]);
    const subscription = await rows(client, `SELECT status, current_period_end FROM subscriptions WHERE user_id = $1`, [userId]);
    return { account: account[0] ?? null, roles, subscription: subscription[0] ?? null };
  }

  private async goalsSection(client: PoolClient, userId: string) {
    return {
      goals: await rows(
        client,
        `SELECT g.*, h.cadence, h.target_count_per_period, h.current_streak, h.longest_streak
         FROM goals g LEFT JOIN goal_habit_detail h ON h.goal_id = g.id
         WHERE g.user_id = $1 ORDER BY g.created_at`,
        [userId],
      ),
      history: await rows(client, `SELECT * FROM goal_history WHERE user_id = $1 ORDER BY changed_at`, [userId]),
    };
  }
}

async function rows<T = Record<string, unknown>>(client: PoolClient, sql: string, params: unknown[]): Promise<T[]> {
  const result = await client.query(sql, params);
  return result.rows;
}

/**
 * `archiver` 8.x ships as pure ESM (`"type": "module"`, no CJS build at
 * all) — a plain top-level `import` compiles to a `require()` call under
 * this project's CommonJS target, which fails at runtime under ts-jest
 * ("Must use import to load ES Module"), the exact same class of problem
 * `test/*.e2e-spec.ts` already works around for `embedded-postgres` via
 * this identical `new Function` shim — TypeScript itself would otherwise
 * rewrite a literal `import()` into `require()` too, defeating the point.
 */
const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<{ ZipArchive: typeof ZipArchiveType }>;

async function zip(files: Array<{ path: string; content: string }>): Promise<Buffer> {
  const { ZipArchive } = await dynamicImport('archiver');
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));
  for (const file of files) {
    archive.append(Buffer.from(file.content, 'utf-8'), { name: file.path });
  }
  await archive.finalize();
  return Buffer.concat(chunks);
}
