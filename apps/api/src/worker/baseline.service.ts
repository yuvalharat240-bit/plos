import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { TenantDatabaseService } from '../database/tenant-database.service';
import {
  MVP_METRICS,
  MetricDefinition,
  WINDOW_DAYS,
  MIN_SAMPLES,
  NORMAL_Z_THRESHOLD,
  ANOMALY_Z_THRESHOLD,
} from './metric-definitions';

type Classification =
  | 'normal'
  | 'improving'
  | 'deteriorating'
  | 'anomalous'
  | 'repeated_pattern'
  | 'new_pattern';

export interface BaselineRunResult {
  written: number;
  skipped: number;
}

/**
 * docs/09 Milestone 4 / docs/03 §2.5: the Personal Baseline Engine.
 * "Doesn't need a scientific-computing stack" (ADR D2) — rolling mean/
 * stddev/z-score per metric, computed in SQL, classified with simple
 * documented thresholds, not a statistics library.
 */
@Injectable()
export class BaselineService {
  constructor(private readonly db: TenantDatabaseService) {}

  /**
   * T9's must-fix (docs/06-threat-model.md), the specific hazard
   * docs/04 §10 calls out for this task: this is the ONLY entry point
   * the worker calls, and it opens exactly one fresh `runAsUser`
   * transaction per call. The worker's own loop (`worker-main.ts`) must
   * call this once per user, sequentially — never batch multiple users'
   * queries onto one shared client/transaction.
   */
  async computeForUser(userId: string): Promise<BaselineRunResult> {
    return this.db.runAsUser(userId, async (client) => {
      let written = 0;
      let skipped = 0;
      for (const metric of MVP_METRICS) {
        const wrote = await this.computeOne(client, userId, metric);
        if (wrote) {
          written++;
        } else {
          skipped++;
        }
      }
      return { written, skipped };
    });
  }

  private async computeOne(
    client: PoolClient,
    userId: string,
    def: MetricDefinition,
  ): Promise<boolean> {
    const cutoff = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const stats = await client.query(
      `WITH window_data AS (${def.windowDataSql})
       SELECT
         count(*)::int AS n,
         avg(value) AS mean,
         stddev_samp(value) AS stddev,
         (SELECT value FROM window_data ORDER BY observed_at DESC LIMIT 1) AS current_value
       FROM window_data`,
      [cutoff],
    );
    const row = stats.rows[0] as { n: number; mean: string | null; stddev: string | null; current_value: string | null };

    // Not enough data to say anything — write nothing rather than
    // fabricate a classification from 1-2 points (no enum value means
    // "insufficient data," and a `baselines` row is a claim, not a stub).
    if (!row || row.n < MIN_SAMPLES) {
      return false;
    }

    const mean = Number(row.mean);
    const stddev = row.stddev !== null ? Number(row.stddev) : 0;
    const currentValue = Number(row.current_value);
    const z = this.zScore(currentValue, mean, stddev);

    const existing = await client.query(
      `SELECT classification FROM baselines WHERE user_id = $1 AND domain = $2 AND metric = $3 AND window_days = $4`,
      [userId, def.domain, def.metric, WINDOW_DAYS],
    );
    const previous: Classification | undefined = existing.rows[0]?.classification;
    const classification = this.classify(z, def.higherIsBetter, previous);

    await client.query(
      `INSERT INTO baselines
         (user_id, domain, metric, window_days, mean, stddev, current_value, deviation_z, classification, source, is_ai_derived, computed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'context_engine_worker', false, now())
       ON CONFLICT (user_id, domain, metric, window_days)
       DO UPDATE SET mean = $5, stddev = $6, current_value = $7, deviation_z = $8, classification = $9, computed_at = now()`,
      [userId, def.domain, def.metric, WINDOW_DAYS, mean, stddev, currentValue, z, classification],
    );
    return true;
  }

  /** No stddev (every sample identical) means any difference at all is a real outlier, not statistical noise. */
  private zScore(currentValue: number, mean: number, stddev: number): number {
    if (stddev > 0) {
      return (currentValue - mean) / stddev;
    }
    if (currentValue === mean) {
      return 0;
    }
    return currentValue > mean ? ANOMALY_Z_THRESHOLD + 1 : -(ANOMALY_Z_THRESHOLD + 1);
  }

  /**
   * MVP heuristic, not real pattern-mining: `repeated_pattern` means
   * "the same non-normal signal as last time we computed this," and
   * `new_pattern` means "first time this (user, domain, metric, window)
   * has ever been computed." Neither claims to detect a genuine
   * recurring temporal pattern (e.g. "worse on Sundays") — that's a real
   * gap against the enum's apparent intent, deliberately not attempted
   * here; see this file's own header.
   */
  private classify(
    z: number,
    higherIsBetter: boolean | null,
    previous: Classification | undefined,
  ): Classification {
    if (previous === undefined) {
      return 'new_pattern';
    }

    let base: Classification;
    if (Math.abs(z) >= ANOMALY_Z_THRESHOLD) {
      base = 'anomalous';
    } else if (Math.abs(z) <= NORMAL_Z_THRESHOLD) {
      base = 'normal';
    } else if (higherIsBetter === null) {
      base = 'normal';
    } else {
      const effectiveZ = higherIsBetter ? z : -z;
      base = effectiveZ > 0 ? 'improving' : 'deteriorating';
    }

    const wasAlreadyRepeating = previous === 'repeated_pattern' || previous === base;
    if (base !== 'normal' && wasAlreadyRepeating) {
      return 'repeated_pattern';
    }
    return base;
  }
}
