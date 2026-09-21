/** Shared bounds check for a tool's numeric arg — was hand-duplicated
 * across health-tools.ts, mental-health-tools.ts, and fitness-tools.ts
 * with only the key name and bounds changing (ponytail-audit,
 * pre-Milestone-8 pass, 2026-09-21). */
export function validateBoundedNumber(
  args: unknown,
  key: string,
  opts: { min: number; max: number; fallback: number },
): number {
  const value = Number((args as Record<string, unknown>)?.[key] ?? opts.fallback);
  if (!Number.isFinite(value) || value < opts.min || value > opts.max) {
    throw new Error(`${key} must be between ${opts.min} and ${opts.max}`);
  }
  return value;
}
