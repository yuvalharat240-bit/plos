export type AuditActorType = 'user' | 'agent' | 'system' | 'professional' | 'admin';
export type AuditResult = 'success' | 'denied' | 'error';

/** Mirrors docs/04-database-schema.md §11's audit_log columns exactly. */
export interface AuditLogEntry {
  actorType: AuditActorType;
  actorId?: string;
  actingAsUserId: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  riskTier?: number;
  requestId?: string;
  result: AuditResult;
  metadata?: Record<string, unknown>;
  /** Milestone 5: which agent/model/prompt produced this row, and a hash
   * (never raw args, per docs/03 §7) of the tool call it recorded. Optional
   * because every pre-Milestone-5 call site (auth, journal, workouts, sync)
   * has nothing meaningful to put here. */
  agentVersion?: string;
  modelVersion?: string;
  argsHash?: string;
}
