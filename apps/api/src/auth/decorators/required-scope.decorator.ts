import { SetMetadata } from '@nestjs/common';

export const REQUIRED_SCOPE_KEY = 'requiredScope';

/**
 * docs/03 §2.3 — ScopeGuard checks "the entry scope, e.g. agent.ask" —
 * applied here to the plain CRUD entry points (journal/fitness.write
 * etc.) instead, per docs/09 Milestone 2's Context section.
 */
export const RequiredScope = (scope: string) => SetMetadata(REQUIRED_SCOPE_KEY, scope);
