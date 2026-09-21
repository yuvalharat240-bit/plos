import { Injectable } from '@nestjs/common';
import { TenantDatabaseService } from '../database/tenant-database.service';

/**
 * FINDING, same category as 020/024/025's documented doc/implementation
 * gaps: docs/05-agent-architecture.md §3.6 and docs/04-database-schema.md
 * §6.3 both describe `get_calendar_density_tomorrow` reading a `baselines`
 * row "recomputed daily by the worker," and docs/08-mvp-definition.md §4.1
 * scopes `baselines.domain IN ('health','fitness','productivity')" — but
 * Milestone 4's `metric-definitions.ts` / `BaselineService` only ever
 * computed the health/fitness/mental_health z-score metrics; nothing
 * computed the productivity row Milestone 5's own worked example needs
 * ("should I train tonight" reads calendar density tomorrow, docs/03 §4).
 * Found while building Milestone 5's `get_context_snapshot` consumer, not
 * before — fixed here rather than left as a silent gap.
 *
 * This is deliberately NOT folded into `BaselineService.computeForUser`:
 * docs/04 §6.3 itself notes this is "mean/stddev NULL — a derived flag,
 * not a statistical baseline," so it has no window/MIN_SAMPLES/z-score
 * shape to share with the MVP_METRICS loop, and folding it in would
 * silently change `computeForUser`'s already-tested `{written, skipped}`
 * counts for Milestone 4's own verified test suite. Kept as its own small
 * step, called alongside `computeForUser` from worker-main.ts.
 *
 * `classification` is `NOT NULL` on `baselines` even for a non-statistical
 * row (docs/04 §6.1's schema), and none of the six enum values literally
 * mean "busy" — a real ambiguity this document doesn't resolve. Judgment
 * call recorded here: `current_value` holds the actual tomorrow event
 * count; `classification` is 'anomalous' when that count is unusually
 * high (>= BUSY_THRESHOLD) and 'normal' otherwise — reusing the existing
 * enum rather than inventing schema, matching ADR D2's "doesn't need a
 * scientific-computing stack" framing for this whole engine.
 */
const BUSY_THRESHOLD = 3;

@Injectable()
export class CalendarDensityService {
  constructor(private readonly db: TenantDatabaseService) {}

  async computeForUser(userId: string): Promise<void> {
    await this.db.runAsUser(userId, async (client) => {
      const result = await client.query(
        `SELECT count(*)::int AS n
         FROM events e JOIN event_calendar_item c ON c.event_id = e.id
         WHERE e.user_id = $1 AND e.domain = 'productivity'
           AND e.starts_at >= date_trunc('day', now()) + interval '1 day'
           AND e.starts_at <  date_trunc('day', now()) + interval '2 days'`,
        [userId],
      );
      const count = result.rows[0].n as number;
      const classification = count >= BUSY_THRESHOLD ? 'anomalous' : 'normal';

      await client.query(
        `INSERT INTO baselines (user_id, domain, metric, window_days, mean, stddev, current_value, deviation_z, classification, source, is_ai_derived)
         VALUES ($1, 'productivity', 'calendar_density_next_day', 1, NULL, NULL, $2, NULL, $3, 'context_engine_worker', false)
         ON CONFLICT (user_id, domain, metric, window_days)
         DO UPDATE SET current_value = EXCLUDED.current_value, classification = EXCLUDED.classification, computed_at = now()`,
        [userId, count, classification],
      );
    });
  }
}
