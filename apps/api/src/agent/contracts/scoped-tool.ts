import { PoolClient } from 'pg';

/**
 * docs/05-agent-architecture.md §6 — the contract shape every Scoped Tool
 * declares, and docs/03-system-architecture.md §2.7's "the only path from
 * any agent to data or to an action." `execute` receives an already
 * `runAsUser`-scoped `PoolClient` (docs/04 §10.1) — a tool never opens its
 * own connection, so it structurally cannot escape the caller's RLS
 * session variable.
 */
export type DataClass = 'derived' | 'raw' | 'write';
export type RiskTier = 0 | 1 | 2 | 3 | 4;

export interface ToolExecutionContext {
  userId: string;
  agentName: string;
  client: PoolClient;
  /** The caller's currently-granted scopes (docs/04 §8.2's active
   * `permission_grants`, already resolved by ScopeGuard). Most tools
   * never need this — authorization already happened before `execute`
   * runs — but `get_context_snapshot` (05 §5) fans out to several
   * domains' own `<domain>.read` scopes internally and must omit any the
   * caller doesn't hold, rather than being gated by one scope itself. */
  scopes: string[];
}

export interface ScopedToolContract<Args = unknown, Result = unknown> {
  name: string;
  domain: string;
  dataClass: DataClass;
  riskTier: RiskTier;
  requiredScope: string;
  /** Static per-agent ceiling (05 §1) — the maximum set of agents that
   * could ever be configured to call this tool. */
  callableBy: string[];
  /** JSON-schema-shaped description handed to the model so it knows the
   * tool exists and how to call it — independent of `validate`, which is
   * the actual enforcement (05 §6 step 4 is explicit that validation must
   * not trust the SDK's own type system). */
  description: string;
  inputSchema: Record<string, unknown>;
  validate(args: unknown): Args;
  requiresConfirmation(args: Args): boolean;
  execute(ctx: ToolExecutionContext, args: Args): Promise<Result>;
}
