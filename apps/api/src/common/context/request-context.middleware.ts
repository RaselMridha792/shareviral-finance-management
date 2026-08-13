import { randomUUID } from "node:crypto";

import type { NextFunction, Request, Response } from "express";

import { runWithRequestContext } from "./request-context";

/**
 * Opens the AsyncLocalStorage scope for each request.
 *
 * This is middleware, not an interceptor, deliberately: Nest runs guards
 * *before* interceptors, so an interceptor-based context would not exist yet
 * when JwtAuthGuard resolves the user — and the audit trail would have no
 * actor. Middleware wraps everything that follows, guards included.
 */
export function requestContextMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const requestId =
    (request.headers["x-request-id"] as string | undefined) ?? randomUUID();
  response.setHeader("x-request-id", requestId);

  runWithRequestContext(
    {
      requestId,
      route: request.originalUrl ?? request.url,
      method: request.method,
      ip: request.ip,
      userAgent: request.headers["user-agent"],
      // Filled in by JwtAuthGuard once the token is verified.
      userId: undefined,
      role: undefined,
      auditWritten: false,
    },
    () => next(),
  );
}
