/**
 * docs/03-system-architecture.md §2.3 — the one object AuthGuard/
 * ScopeGuard/EntitlementGuard produce, resolved entirely server-side from
 * the verified access token. Nothing past this point trusts any other
 * identity claim, including anything client-supplied.
 */
export interface RequestContext {
  userId: string;
  sessionId: string;
  scopes: string[];
  entitlementTier: string;
}

declare module 'express' {
  interface Request {
    requestContext?: RequestContext;
  }
}
