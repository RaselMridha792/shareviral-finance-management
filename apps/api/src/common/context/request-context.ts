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
  /**
   * Set while the Assistant saves a draft somebody confirmed (A4): every
   * audit row written meanwhile says it came through the Assistant. Only
   * `throughTheAssistant` sets it.
   */
  via?: "assistant";
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

/**
 * Runs `fn` as a save the person confirmed in the Assistant's chat (A4).
 *
 * The record's own service writes its own audit row, as it does for the
 * form; this only marks that row as having come through the Assistant. Put
 * back afterwards, so nothing else the same request writes is marked.
 */
export async function throughTheAssistant<T>(fn: () => Promise<T>): Promise<T> {
  const context = storage.getStore();
  const before = context?.via;
  if (context) context.via = "assistant";
  try {
    return await fn();
  } finally {
    if (context) context.via = before;
  }
}
