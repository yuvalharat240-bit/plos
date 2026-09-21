/**
 * docs/09 Milestone 4: "rolling mean/stddev/z-score into `baselines` for
 * sleep, training-load, and mood/stress (the three MVP domains)." Mood
 * and stress are two separate metrics (separate `baselines` rows, per
 * the table's own `(user_id, domain, metric, window_days)` uniqueness) —
 * "mood/stress" in the plan names one domain conversationally, not one
 * column.
 *
 * `higherIsBetter` drives the improving/deteriorating direction call in
 * `BaselineService.classify`: sleep and mood are unambiguous (more is
 * better), stress is the opposite (more is worse), and training_load is
 * marked `null` — deliberately not guessing a direction ("more training
 * load" isn't reliably good or bad without a lot more domain modeling
 * this MVP worker doesn't attempt, per ADR D2's own "doesn't need a
 * scientific-computing stack" framing).
 */
export interface MetricDefinition {
  domain: string;
  metric: string;
  higherIsBetter: boolean | null;
  /** A `(observed_at, value)` query, parameterized by `$1` = the window's cutoff timestamp. */
  windowDataSql: string;
}

export const WINDOW_DAYS = 14;
export const MIN_SAMPLES = 3;
export const NORMAL_Z_THRESHOLD = 1.0;
export const ANOMALY_Z_THRESHOLD = 2.5;

export const MVP_METRICS: MetricDefinition[] = [
  {
    domain: 'health',
    metric: 'sleep_duration_min',
    higherIsBetter: true,
    windowDataSql: `
      SELECT o.observed_at, s.duration_min AS value
      FROM observations o
      JOIN observation_sleep s ON s.observation_id = o.id
      WHERE o.domain = 'health' AND s.duration_min IS NOT NULL AND o.observed_at >= $1::timestamptz
    `,
  },
  {
    domain: 'fitness',
    metric: 'training_load',
    higherIsBetter: null,
    windowDataSql: `
      SELECT e.starts_at AS observed_at, f.training_load AS value
      FROM events e
      JOIN event_fitness_session f ON f.event_id = e.id
      WHERE e.domain = 'fitness' AND f.training_load IS NOT NULL AND e.starts_at >= $1::timestamptz
    `,
  },
  {
    domain: 'mental_health',
    metric: 'mood_score',
    higherIsBetter: true,
    windowDataSql: `
      SELECT o.observed_at, j.mood_score AS value
      FROM observations o
      JOIN observation_journal_entry j ON j.observation_id = o.id
      WHERE o.domain = 'mental_health' AND j.mood_score IS NOT NULL AND o.observed_at >= $1::timestamptz
    `,
  },
  {
    domain: 'mental_health',
    metric: 'stress_score',
    higherIsBetter: false,
    windowDataSql: `
      SELECT o.observed_at, j.stress_score AS value
      FROM observations o
      JOIN observation_journal_entry j ON j.observation_id = o.id
      WHERE o.domain = 'mental_health' AND j.stress_score IS NOT NULL AND o.observed_at >= $1::timestamptz
    `,
  },
];
