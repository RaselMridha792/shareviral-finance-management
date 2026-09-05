import { AsyncLocalStorage } from "node:async_hooks";

import type { StoredRole } from "@finance/shared";

export type RequestContext = {
  requestId: string;
  route: string;
  method: string;
  ip?: string;
  userAgent?: string;
  userId?: string;
  /* Stored, not assignable — see AuthenticatedUser. */
  role?: StoredRole;
  /** Set by the audit writer so the safety-net interceptor knows to stand down. */
  auditWritten: boolean;
};

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(
  context: RequestContext,
  fn: () => T,
): T {
  return storage.run(context, fn);
}

/**
 * The current request's context, or undefined outside a request (jobs, boot).
 * Services read the actor from here rather than threading it through every
 * method signature.
 */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function markAuditWritten(): void {
  const context = storage.getStore();
  if (context) context.auditWritten = true;
}
